import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createClient, type RedisClientType } from 'redis';
import { type StageError } from './attempts';
import { AppConfig } from './config';
import { Prisma } from '@calls/db';
import { Database, isUniqueViolation } from './db';
import { type ListRedis, recoverReserved, runFairLoop } from './fair-loop';
import { handleTranscribe } from './handle-transcribe';
import { ANALYZE_QUEUE, parseTranscribeMessage, TRANSCRIBE_QUEUE, type AnalyzeMessage } from './messages';
import { type Replica } from './roles';
import { requestTranscript, SpeechTransportError, speechEndpoint } from './speech';
import { Recordings } from './storage';

const RESERVED = 'calls.transcribe.reserved';

@Injectable()
export class TranscribeWorker implements OnModuleInit, OnModuleDestroy {
  private client: RedisClientType | null = null;
  private stopped = false;
  private loop: Promise<void> = Promise.resolve();

  constructor(
    private readonly config: AppConfig,
    private readonly db: Database,
    private readonly recordings: Recordings,
  ) {}

  async onModuleInit(): Promise<void> {
    const client = createClient({ url: this.config.redisUrl });
    client.on('error', (error) => {
      console.error('redis error', error);
    });
    await client.connect();
    this.client = client as RedisClientType;
    const lists = asLists(this.client);
    await recoverReserved(lists, RESERVED, TRANSCRIBE_QUEUE);
    this.loop = runFairLoop({
      redis: lists,
      queue: TRANSCRIBE_QUEUE,
      reserved: RESERVED,
      ceiling: this.config.concurrency,
      stopped: () => this.stopped,
      parse: parseTranscribeMessage,
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

  private async handle(message: NonNullable<ReturnType<typeof parseTranscribeMessage>>): Promise<void> {
    if (!this.client) {
      return;
    }
    const result = await handleTranscribe(message, {
      now: () => new Date().toISOString(),
      newId: () => randomUUID(),
      loadCall: (projectId, callId) => this.loadCall(projectId, callId),
      loadTranscript: (callId) => this.loadTranscript(callId),
      markTranscribing: (projectId, callId) => this.markTranscribing(projectId, callId),
      ensureAnalysis: (callId) => this.ensureAnalysis(callId),
      getObject: (bucket, key) => this.recordings.get(bucket, key),
      recognize: async (input) => {
        const endpoint = speechEndpoint({
          STT_API_URL: this.config.sttApiUrl,
          STT_PROVIDER: this.config.sttProvider,
        });
        if (!endpoint) {
          throw new SpeechTransportError('speech api is not configured');
        }
        return requestTranscript({
          url: endpoint.url,
          apiKey: this.config.sttApiKey,
          provider: endpoint.provider,
          timeoutMs: this.config.sttTimeoutMs,
          bytes: input.bytes,
          filename: input.filename,
          contentType: input.contentType,
        });
      },
      saveTranscript: (callId, replicas) => this.saveTranscript(callId, replicas),
      enqueueAnalyze: (queued) => this.enqueue(queued),
      fail: (projectId, callId, error) => this.fail(projectId, callId, error),
    });
    if (result.action === 'retry') {
      await this.client.rPush(TRANSCRIBE_QUEUE, JSON.stringify(result.message));
    }
  }

  private async loadCall(
    projectId: string,
    callId: string,
  ): Promise<{ processing_status: string; direction: string | null } | null> {
    return this.db.client.call.findFirst({
      where: { id: callId, project_id: projectId },
      select: { processing_status: true, direction: true },
    });
  }

  private async loadTranscript(callId: string): Promise<Replica[] | null> {
    const row = await this.db.client.callAnalysis.findUnique({
      where: { call_id: callId },
      select: { transcript_json: true },
    });
    const value = row?.transcript_json;
    return Array.isArray(value) ? (value as Replica[]) : null;
  }

  private async markTranscribing(projectId: string, callId: string): Promise<void> {
    await this.db.client.call.updateMany({
      where: {
        id: callId,
        project_id: projectId,
        processing_status: { in: ['audio_fetch', 'audio_queued', 'transcribing', 'recording_pending'] },
      },
      data: { processing_status: 'transcribing', updated_at: new Date() },
    });
  }

  private async ensureAnalysis(callId: string): Promise<void> {
    try {
      await this.db.client.callAnalysis.create({
        data: { id: randomUUID(), call_id: callId },
      });
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
    }
  }

  private async saveTranscript(callId: string, replicas: Replica[]): Promise<void> {
    await this.db.client.callAnalysis.updateMany({
      where: { call_id: callId, transcript_json: { equals: Prisma.DbNull } },
      data: { transcript_json: replicas as unknown as Prisma.InputJsonValue },
    });
  }

  private async fail(projectId: string, callId: string, error: StageError): Promise<void> {
    await this.db.client.call.updateMany({
      where: {
        id: callId,
        project_id: projectId,
        processing_status: { in: ['transcribing', 'audio_fetch', 'audio_queued'] },
      },
      data: { processing_status: 'failed', error, updated_at: new Date() },
    });
  }

  private async enqueue(message: AnalyzeMessage): Promise<void> {
    if (!this.client) {
      throw new Error('redis is not connected');
    }
    await this.client.rPush(ANALYZE_QUEUE, JSON.stringify(message));
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
