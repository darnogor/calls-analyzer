import { ChatCompletionsClient, ChatTransportError } from '@calls/chat-completions';
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createClient, type RedisClientType } from 'redis';
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
    const result = await this.db.query<{
      processing_status: string;
      transcript_json: unknown;
      overall_score: number | null;
    }>(
      `select c.processing_status, a.transcript_json, a.overall_score
       from calls c
       left join call_analysis a on a.call_id = c.id
       where c.id = $1 and c.project_id = $2`,
      [callId, projectId],
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    return {
      processing_status: row.processing_status,
      transcript: row.transcript_json ?? null,
      overall_score: row.overall_score,
    };
  }

  private async loadStages(projectId: string): Promise<StageInput[] | null> {
    const result = await this.db.query<{ stages_json: unknown }>(
      'select stages_json from scorecards where project_id = $1 order by version desc limit 1',
      [projectId],
    );
    if (!result.rows[0]) {
      return null;
    }
    return readStages(result.rows[0].stages_json);
  }

  private async loadScripts(projectId: string): Promise<ScriptInput[]> {
    const result = await this.db.query<ScriptInput>(
      'select title, body from project_inputs where project_id = $1 order by updated_at asc, id asc',
      [projectId],
    );
    return result.rows.map((row) => ({ title: row.title, body: row.body }));
  }

  private async markAnalyzing(projectId: string, callId: string): Promise<void> {
    await this.db.query(
      `update calls
       set processing_status = 'analyzing', updated_at = now()
       where id = $1 and project_id = $2
         and processing_status in ('transcribing', 'analyzing', 'audio_fetch', 'audio_queued')`,
      [callId, projectId],
    );
  }

  private async save(callId: string, score: ScoreWrite): Promise<boolean> {
    const result = await this.db.query(
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
      [
        randomUUID(),
        callId,
        JSON.stringify(score.inputs),
        JSON.stringify(score.stages),
        score.summary,
        score.overall,
        score.model,
      ],
    );
    return (result.rowCount ?? 0) > 0;
  }

  private async markCompleted(projectId: string, callId: string): Promise<void> {
    await this.db.query(
      `update calls
       set processing_status = 'completed', error = null, updated_at = now()
       where id = $1 and project_id = $2
         and processing_status not in ('failed', 'skipped_short', 'skipped_no_duration', 'recording_missing')`,
      [callId, projectId],
    );
  }

  private async fail(projectId: string, callId: string, error: StageError): Promise<void> {
    await this.db.query(
      `update calls
       set processing_status = 'failed', error = $3::jsonb, updated_at = now()
       where id = $1 and project_id = $2
         and processing_status in ('analyzing', 'transcribing', 'audio_fetch', 'audio_queued')`,
      [callId, projectId, JSON.stringify(error)],
    );
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
