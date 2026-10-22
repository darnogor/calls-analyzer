import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createClient, type RedisClientType } from 'redis';
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
    const result = await this.db.query<CallAudio>(
      `select processing_status, duration_sec, recording_storage_key, recording_content_type
       from calls where id = $1 and project_id = $2`,
      [callId, projectId],
    );
    return result.rows[0] ?? null;
  }

  private async loadMinDuration(projectId: string): Promise<number | null> {
    const result = await this.db.query<{ min_call_duration_sec: number }>(
      'select min_call_duration_sec from projects where id = $1',
      [projectId],
    );
    return result.rows[0]?.min_call_duration_sec ?? null;
  }

  private async claim(projectId: string, callId: string): Promise<boolean> {
    const result = await this.db.query(
      `update calls
       set processing_status = 'audio_fetch', updated_at = now()
       where id = $1 and project_id = $2 and processing_status = any($3::text[])`,
      [callId, projectId, ACTIVE],
    );
    return (result.rowCount ?? 0) > 0;
  }

  private async saveObject(projectId: string, callId: string, key: string, contentType: string): Promise<void> {
    await this.db.query(
      `update calls
       set recording_storage_key = $3, recording_content_type = $4, updated_at = now()
       where id = $1 and project_id = $2 and processing_status = any($5::text[])`,
      [callId, projectId, key, contentType, ACTIVE],
    );
  }

  private async saveDuration(projectId: string, callId: string, durationSec: number): Promise<void> {
    await this.db.query(
      `update calls
       set duration_sec = $3, updated_at = now()
       where id = $1 and project_id = $2 and duration_sec is null and processing_status = any($4::text[])`,
      [callId, projectId, durationSec, ACTIVE],
    );
  }

  private async finish(
    projectId: string,
    callId: string,
    status: 'skipped_short' | 'skipped_no_duration' | 'recording_missing',
    fields: { durationSec: number | null; key: string | null; contentType: string | null },
  ): Promise<void> {
    await this.db.query(
      `update calls
       set processing_status = $3,
           duration_sec = coalesce($4, duration_sec),
           recording_storage_key = coalesce($5, recording_storage_key),
           recording_content_type = coalesce($6, recording_content_type),
           error = null,
           updated_at = now()
       where id = $1 and project_id = $2 and processing_status = any($7::text[])`,
      [callId, projectId, status, fields.durationSec, fields.key, fields.contentType, ACTIVE],
    );
  }

  private async fail(projectId: string, callId: string, error: StageError): Promise<void> {
    await this.db.query(
      `update calls
       set processing_status = 'failed', error = $3::jsonb, updated_at = now()
       where id = $1 and project_id = $2 and processing_status = any($4::text[])`,
      [callId, projectId, JSON.stringify(error), ACTIVE],
    );
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
