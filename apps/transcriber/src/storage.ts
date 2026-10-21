import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Injectable } from '@nestjs/common';
import { AppConfig } from './config';

@Injectable()
export class Recordings {
  private readonly s3: S3Client;

  constructor(config: AppConfig) {
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

function isMissingObject(error: unknown): boolean {
  const name = (error as { name?: string }).name;
  const code = (error as { Code?: string }).Code;
  const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
  return name === 'NotFound' || name === 'NoSuchKey' || code === 'NoSuchKey' || code === 'NotFound' || status === 404;
}
