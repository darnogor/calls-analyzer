import { ChatCompletionsClient, ChatTransportError } from '@calls/chat-completions';
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createClient, type RedisClientType } from 'redis';
import { Prisma } from '@calls/db';
import { type StageError } from './attempts';
import { AppConfig } from './config';
import { Database } from './db';
import { type ListRedis, recoverReserved, runFairLoop } from './fair-loop';
import { handleAnalyze, type AnalysisState, type ScoreWrite, type ScorecardInput } from './handle-analyze';
import { ANALYZE_QUEUE, parseAnalyzeMessage } from './messages';
import { readStages } from './score';

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
      loadScorecard: (projectId) => this.loadScorecard(projectId),
      loadPrompt: (projectId) => this.loadPrompt(projectId),
      loadFacts: (projectId) => this.loadFacts(projectId),
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
        company_name: true,
        manager: { select: { name: true } },
        contact: { select: { name: true, company_name: true } },
        analysis: { select: { transcript_json: true, overall_score: true, stages_json: true } },
      },
    });
    if (!call) {
      return null;
    }
    const company = call.company_name || call.contact?.company_name || null;
    return {
      processing_status: call.processing_status,
      transcript: call.analysis?.transcript_json ?? null,
      overall_score: call.analysis?.overall_score ?? null,
      analyzed: call.analysis?.stages_json != null,
      manager: call.manager ? { name: call.manager.name } : null,
      client: call.contact ? { name: call.contact.name, company } : null,
    };
  }

  private async loadScorecard(projectId: string): Promise<ScorecardInput | null> {
    const card = await this.db.client.scorecard.findFirst({
      where: { project_id: projectId },
      orderBy: { version: 'desc' },
      select: { stages_json: true, card_key: true },
    });
    if (!card) {
      return null;
    }
    const stages = readStages(card.stages_json);
    if (!stages) {
      return null;
    }
    return { cardKey: card.card_key, stages };
  }

  private async loadPrompt(projectId: string): Promise<string> {
    const row = await this.db.client.scoringPrompt.findFirst({
      where: { project_id: projectId },
      orderBy: { version: 'desc' },
      select: { body: true },
    });
    return row?.body ?? '';
  }

  private async loadFacts(projectId: string): Promise<string> {
    const row = await this.db.client.productFact.findFirst({
      where: { project_id: projectId },
      orderBy: { version: 'desc' },
      select: { body: true },
    });
    return row?.body ?? '';
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
    // The update runs only while stages are still empty, so a finished analysis is not overwritten.
    const updated = await this.db.client.$executeRawUnsafe(
      `insert into call_analysis (
         id, call_id, inputs_json, stages_json, summary, overall_score, extras_json, ai_model, created_at
       ) values ($1, $2, $3::jsonb, $4::jsonb, null, $5, $6::jsonb, $7, now())
       on conflict (call_id) do update set
         inputs_json = excluded.inputs_json,
         stages_json = excluded.stages_json,
         overall_score = excluded.overall_score,
         extras_json = excluded.extras_json,
         ai_model = excluded.ai_model,
         created_at = now()
       where call_analysis.stages_json is null`,
      randomUUID(),
      callId,
      JSON.stringify(score.inputs),
      JSON.stringify(score.stages),
      score.overall,
      JSON.stringify(score.extras),
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
