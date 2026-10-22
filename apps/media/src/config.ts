import { Injectable } from '@nestjs/common';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

function integer(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

@Injectable()
export class AppConfig {
  readonly databaseUrl = required('DATABASE_URL');
  readonly redisUrl = required('REDIS_URL');
  readonly s3Endpoint = required('S3_ENDPOINT');
  readonly s3AccessKey = required('S3_ACCESS_KEY');
  readonly s3SecretKey = required('S3_SECRET_KEY');
  readonly s3Bucket = process.env.S3_BUCKET?.trim() || 'recordings';
  readonly port = integer('PORT', 3000);
  readonly fetchTimeoutMs = integer('MEDIA_FETCH_TIMEOUT_MS', 10_000);
  readonly concurrency = integer('MEDIA_CONCURRENCY', 4);
}
