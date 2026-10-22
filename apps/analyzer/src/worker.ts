import { ChatCompletionsClient, ChatTransportError } from '@calls/chat-completions';
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createClient, type RedisClientType } from 'redis';
import { Prisma } from '@calls/db';
import { type StageError } from './attempts';
import { AppConfig } from './config';
import { Database } from './db';
import { type ListRedis, recoverReserved, runFairLoop } from './fair-loop';
import { handleAnalyze, type AnalysisState, type ScoreWrite, type ScriptInput } from './handle-analyze';
import { ANALYZE_QUEUE, parseAnalyzeMessage } from './messages';
import { readStages, type StageInput } from './score';

const RESERVED = 'calls.analyze.reserved';

@Injectable()
export class AnalyzeWorker implements OnModuleInit, OnModuleDestroy {
  private client: RedisClientType | null = null;
  private stopped = false;
  private loop: Promise<void> = Promise.resolve();
  private readonly chat: ChatCompletionsClient;

  constructor(
    private readonly config: AppConfig,
    private readonly db: Database,
  ) {
    this.chat = new ChatCompletionsClient({
      baseUrl: config.llmBaseUrl || 'http://127.0.0.1',
      apiKey: config.llmApiKey,
      timeoutMs: config.llmTimeoutMs,
    });
  }

  async onModuleInit(): Promise<void> {
    const client = createClient({ url: this.config.redisUrl });
    client.on('error', (error) => {
      console.error('redis error', error);
    });
    await client.connect();
    this.client = client as RedisClientType;
    const lists = asLists(this.client);
    await recoverReserved(lists, RESERVED, ANALYZE_QUEUE);
    this.loop = runFairLoop({
      redis: lists,
      queue: ANALYZE_QUEUE,
      reserved: RESERVED,
      ceiling: this.config.concurrency,
      stopped: () => this.stopped,
      parse: parseAnalyzeMessage,
      handle: (message) => this.handle(message),
    });
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    await this.loop;
    if (this.client) {
      await this.client.quit();
    }
  }

  private async handle(message: NonNullable<ReturnType<typeof parseAnalyzeMessage>>): Promise<void> {
    if (!this.client) {
      return;
    }
    const result = await handleAnalyze(message, {
      now: () => new Date().toISOString(),
      newId: () => randomUUID(),
      model: this.config.llmModel,
      load: (projectId, callId) => this.load(projectId, callId),
      loadStages: (projectId) => this.loadStages(projectId),
      loadScripts: (projectId) => this.loadScripts(projectId),
      markAnalyzing: (projectId, callId) => this.markAnalyzing(projectId, callId),
      save: (callId, score) => this.save(callId, score),
      markCompleted: (projectId, callId) => this.markCompleted(projectId, callId),
      fail: (projectId, callId, error) => this.fail(projectId, callId, error),
      complete: async (input) => {
        if (!this.config.llmBaseUrl || !this.config.llmModel) {
          throw new ChatTransportError('language model is not configured');
        }
        return this.chat.complete(input);
      },
    });
    if (result.action === 'retry') {
      await this.client.rPush(ANALYZE_QUEUE, JSON.stringify(result.message));
    }
  }

  private async load(projectId: string, callId: string): Promise<AnalysisState | null> {
    const call = await this.db.client.call.findFirst({
      where: { id: callId, project_id: projectId },
      select: {
        processing_status: true,
        analysis: { select: { transcript_json: true, overall_score: true } },
      },
    });
    if (!call) {
      return null;
    }
    return {
      processing_status: call.processing_status,
      transcript: call.analysis?.transcript_json ?? null,
      overall_score: call.analysis?.overall_score ?? null,
    };
  }

  private async loadStages(projectId: string): Promise<StageInput[] | null> {
    const card = await this.db.client.scorecard.findFirst({
      where: { project_id: projectId },
      orderBy: { version: 'desc' },
      select: { stages_json: true },
    });
    if (!card) {
      return null;
    }
    return readStages(card.stages_json);
  }

  private async loadScripts(projectId: string): Promise<ScriptInput[]> {
    const rows = await this.db.client.projectInput.findMany({
      where: { project_id: projectId },
      orderBy: [{ updated_at: 'asc' }, { id: 'asc' }],
      select: { title: true, body: true },
    });
    return rows.map((row) => ({ title: row.title, body: row.body }));
  }

  private async markAnalyzing(projectId: string, callId: string): Promise<void> {
    await this.db.client.call.updateMany({
      where: {
        id: callId,
        project_id: projectId,
        processing_status: { in: ['transcribing', 'analyzing', 'audio_fetch', 'audio_queued'] },
      },
      data: { processing_status: 'analyzing', updated_at: new Date() },
    });
  }

  private async save(callId: string, score: ScoreWrite): Promise<boolean> {
    // Prisma upsert cannot keep the existing score: the update runs only while overall_score is null.
    const updated = await this.db.client.$executeRawUnsafe(
      `insert into call_analysis (
         id, call_id, inputs_json, stages_json, summary, overall_score, ai_model, created_at
       ) values ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7, now())
       on conflict (call_id) do update set
         inputs_json = excluded.inputs_json,
         stages_json = excluded.stages_json,
         summary = excluded.summary,
         overall_score = excluded.overall_score,
         ai_model = excluded.ai_model,
         created_at = now()
       where call_analysis.overall_score is null`,
      randomUUID(),
      callId,
      JSON.stringify(score.inputs),
      JSON.stringify(score.stages),
      score.summary,
      score.overall,
      score.model,
    );
    return updated > 0;
  }

  private async markCompleted(projectId: string, callId: string): Promise<void> {
    await this.db.client.call.updateMany({
      where: {
        id: callId,
        project_id: projectId,
        processing_status: { notIn: ['failed', 'skipped_short', 'skipped_no_duration', 'recording_missing'] },
      },
      data: { processing_status: 'completed', error: Prisma.DbNull, updated_at: new Date() },
    });
  }

  private async fail(projectId: string, callId: string, error: StageError): Promise<void> {
    await this.db.client.call.updateMany({
      where: {
        id: callId,
        project_id: projectId,
        processing_status: { in: ['analyzing', 'transcribing', 'audio_fetch', 'audio_queued'] },
      },
      data: { processing_status: 'failed', error, updated_at: new Date() },
    });
  }
}

function asLists(client: RedisClientType): ListRedis {
  return {
    lMove: (source, destination, from, to) => client.lMove(source, destination, from, to),
    blMove: (source, destination, from, to, timeout) => client.blMove(source, destination, from, to, timeout),
    lRem: (key, count, element) => client.lRem(key, count, element),
    rPush: (key, value) => client.rPush(key, value),
  };
}
