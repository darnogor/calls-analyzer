import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createClient, type RedisClientType } from 'redis';
import { Prisma } from '@calls/db';
import { type StageError } from './attempts';
import { AppConfig } from './config';
import { Database } from './db';
import { fetchAudio } from './fetch-audio';
import { handleAudioFetch, type CallAudio } from './handle-audio';
import { AUDIO_FETCH_QUEUE, parseAudioMessage, TRANSCRIBE_QUEUE, type TranscribeMessage } from './messages';
import { type ListRedis, recoverReserved, runPoolLoop } from './pool-loop';
import { Recordings } from './storage';

const RESERVED = 'calls.audio.fetch.reserved';
const ACTIVE = ['audio_queued', 'audio_fetch', 'recording_pending'];

@Injectable()
export class MediaWorker implements OnModuleInit, OnModuleDestroy {
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
    await recoverReserved(lists, RESERVED, AUDIO_FETCH_QUEUE);
    this.loop = runPoolLoop({
      redis: lists,
      queue: AUDIO_FETCH_QUEUE,
      reserved: RESERVED,
      concurrency: this.config.concurrency,
      stopped: () => this.stopped,
      handle: (raw) => this.handle(raw),
    });
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    await this.loop;
    if (this.client) {
      await this.client.quit();
    }
  }

  private async handle(raw: string): Promise<void> {
    const message = parseAudioMessage(raw);
    if (!message || !this.client) {
      return;
    }
    const result = await handleAudioFetch(message, {
      now: () => new Date().toISOString(),
      newId: () => randomUUID(),
      bucket: this.config.s3Bucket,
      loadCall: (projectId, callId) => this.loadCall(projectId, callId),
      loadMinDuration: (projectId) => this.loadMinDuration(projectId),
      claim: (projectId, callId) => this.claim(projectId, callId),
      saveObject: (projectId, callId, key, contentType) => this.saveObject(projectId, callId, key, contentType),
      saveDuration: (projectId, callId, durationSec) => this.saveDuration(projectId, callId, durationSec),
      finish: (projectId, callId, status, fields) => this.finish(projectId, callId, status, fields),
      fail: (projectId, callId, error) => this.fail(projectId, callId, error),
      putObject: (key, body, contentType) => this.recordings.put(key, body, contentType),
      getObject: (bucket, key) => this.recordings.get(bucket, key),
      fetchUrl: (url) => fetchAudio(url, this.config.fetchTimeoutMs),
      enqueueTranscribe: (queued) => this.enqueue(TRANSCRIBE_QUEUE, queued),
    });
    if (result.action === 'retry') {
      await this.client.rPush(AUDIO_FETCH_QUEUE, JSON.stringify(result.message));
    }
  }

  private async loadCall(projectId: string, callId: string): Promise<CallAudio | null> {
    return this.db.client.call.findFirst({
      where: { id: callId, project_id: projectId },
      select: {
        processing_status: true,
        duration_sec: true,
        recording_storage_key: true,
        recording_content_type: true,
      },
    });
  }

  private async loadMinDuration(projectId: string): Promise<number | null> {
    const project = await this.db.client.project.findUnique({
      where: { id: projectId },
      select: { min_call_duration_sec: true },
    });
    return project?.min_call_duration_sec ?? null;
  }

  private activeWhere(projectId: string, callId: string) {
    return { id: callId, project_id: projectId, processing_status: { in: [...ACTIVE] } };
  }

  private async claim(projectId: string, callId: string): Promise<boolean> {
    const result = await this.db.client.call.updateMany({
      where: this.activeWhere(projectId, callId),
      data: { processing_status: 'audio_fetch', updated_at: new Date() },
    });
    return result.count > 0;
  }

  private async saveObject(projectId: string, callId: string, key: string, contentType: string): Promise<void> {
    await this.db.client.call.updateMany({
      where: this.activeWhere(projectId, callId),
      data: {
        recording_storage_key: key,
        recording_content_type: contentType,
        updated_at: new Date(),
      },
    });
  }

  private async saveDuration(projectId: string, callId: string, durationSec: number): Promise<void> {
    await this.db.client.call.updateMany({
      where: { ...this.activeWhere(projectId, callId), duration_sec: null },
      data: { duration_sec: durationSec, updated_at: new Date() },
    });
  }

  private async finish(
    projectId: string,
    callId: string,
    status: 'skipped_short' | 'skipped_no_duration' | 'recording_missing',
    fields: { durationSec: number | null; key: string | null; contentType: string | null },
  ): Promise<void> {
    await this.db.client.call.updateMany({
      where: this.activeWhere(projectId, callId),
      data: {
        processing_status: status,
        ...(fields.durationSec !== null ? { duration_sec: fields.durationSec } : {}),
        ...(fields.key !== null ? { recording_storage_key: fields.key } : {}),
        ...(fields.contentType !== null ? { recording_content_type: fields.contentType } : {}),
        error: Prisma.DbNull,
        updated_at: new Date(),
      },
    });
  }

  private async fail(projectId: string, callId: string, error: StageError): Promise<void> {
    await this.db.client.call.updateMany({
      where: this.activeWhere(projectId, callId),
      data: {
        processing_status: 'failed',
        error,
        updated_at: new Date(),
      },
    });
  }

  private async enqueue(queue: string, message: TranscribeMessage): Promise<void> {
    if (!this.client) {
      throw new Error('redis is not connected');
    }
    await this.client.rPush(queue, JSON.stringify(message));
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
