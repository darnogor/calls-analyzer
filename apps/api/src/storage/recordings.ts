import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Injectable, OnModuleInit } from '@nestjs/common';
import type { Readable } from 'node:stream';
import { AppConfig } from '../config';

@Injectable()
export class Recordings implements OnModuleInit {
  private readonly s3: S3Client;

  constructor(private readonly config: AppConfig) {
    this.s3 = new S3Client({
      endpoint: config.s3Endpoint,
      region: 'us-east-1',
      credentials: {
        accessKeyId: config.s3AccessKey,
        secretAccessKey: config.s3SecretKey,
      },
      forcePathStyle: true,
    });
  }

  get bucket(): string {
    return this.config.s3Bucket;
  }

  async onModuleInit(): Promise<void> {
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      try {
        await this.s3.send(new CreateBucketCommand({ Bucket: this.config.s3Bucket }));
        return;
      } catch (error) {
        if (bucketAlreadyExists(error)) {
          return;
        }
        if (attempt === 10) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.config.s3Bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async open(key: string): Promise<{ stream: Readable; contentLength?: number } | null> {
    try {
      const result = await this.s3.send(
        new GetObjectCommand({
          Bucket: this.config.s3Bucket,
          Key: key,
        }),
      );
      const stream = asReadable(result.Body);
      if (!stream) {
        return null;
      }
      return {
        stream,
        contentLength: typeof result.ContentLength === 'number' ? result.ContentLength : undefined,
      };
    } catch (error) {
      if (isMissingObject(error)) {
        return null;
      }
      throw error;
    }
  }

  async remove(key: string): Promise<void> {
    await this.s3.send(
      new DeleteObjectCommand({
        Bucket: this.config.s3Bucket,
        Key: key,
      }),
    );
  }
}

function asReadable(body: unknown): Readable | null {
  if (!body || typeof body !== 'object' || !('pipe' in body)) {
    return null;
  }
  const stream = body as Readable;
  return typeof stream.pipe === 'function' ? stream : null;
}

function isMissingObject(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const named = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return named.name === 'NoSuchKey' || named.name === 'NotFound' || named.$metadata?.httpStatusCode === 404;
}

function bucketAlreadyExists(error: unknown): boolean {
  const name = (error as { name?: string }).name;
  const code = (error as { Code?: string }).Code;
  return (
    name === 'BucketAlreadyOwnedByYou' ||
    name === 'BucketAlreadyExists' ||
    code === 'BucketAlreadyOwnedByYou' ||
    code === 'BucketAlreadyExists'
  );
}
