import {
  CreateBucketCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { AppConfig } from './config';

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

  async get(bucket: string, key: string): Promise<{ body: Buffer; contentType: string | null } | null> {
    try {
      const output = await this.s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!output.Body) {
        return { body: Buffer.alloc(0), contentType: output.ContentType ?? null };
      }
      const body = Buffer.from(await output.Body.transformToByteArray());
      return { body, contentType: output.ContentType ?? null };
    } catch (error) {
      if (isMissingObject(error)) {
        return null;
      }
      throw error;
    }
  }
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

function isMissingObject(error: unknown): boolean {
  const name = (error as { name?: string }).name;
  const code = (error as { Code?: string }).Code;
  const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
  return name === 'NotFound' || name === 'NoSuchKey' || code === 'NoSuchKey' || code === 'NotFound' || status === 404;
}
