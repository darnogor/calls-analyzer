import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createClient, type RedisClientType } from 'redis';
import { AppConfig } from '../config';

export const AUDIO_FETCH_QUEUE = 'calls.audio.fetch';

export type AudioFetchMessage = {
  message_id: string;
  project_id: string;
  call_id: string;
  attempt: 1;
  enqueued_at: string;
  audio:
    | { type: 'url'; url: string }
    | { type: 'object'; bucket: string; key: string; content_type: string };
};

@Injectable()
export class AudioQueue implements OnModuleInit, OnModuleDestroy {
  private client: RedisClientType | null = null;

  constructor(private readonly config: AppConfig) {}

  async onModuleInit(): Promise<void> {
    const client = createClient({ url: this.config.redisUrl });
    client.on('error', (error) => {
      console.error('redis error', error);
    });
    await client.connect();
    this.client = client as RedisClientType;
  }

  async enqueue(message: AudioFetchMessage): Promise<void> {
    if (!this.client) {
      throw new Error('redis is not connected');
    }
    // TODO(docs): the Redis data structure for a queue is not specified.
    // The documented JSON envelope is appended with RPUSH to a list of the queue name.
    await this.client.rPush(AUDIO_FETCH_QUEUE, JSON.stringify(message));
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      await this.client.quit();
    }
  }
}

export function audioFetchMessage(
  projectId: string,
  callId: string,
  audio: AudioFetchMessage['audio'],
): AudioFetchMessage {
  return {
    message_id: randomUUID(),
    project_id: projectId,
    call_id: callId,
    attempt: 1,
    enqueued_at: new Date().toISOString(),
    audio,
  };
}
