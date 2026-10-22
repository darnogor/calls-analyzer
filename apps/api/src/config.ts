import { Injectable } from '@nestjs/common';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}`);
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
  readonly s3Bucket = process.env.S3_BUCKET || 'recordings';
  readonly sessionSecret = required('SESSION_SECRET');
  readonly adminEmail = process.env.ADMIN_EMAIL ?? '';
  readonly adminPassword = process.env.ADMIN_PASSWORD ?? '';
  readonly adminName = process.env.ADMIN_NAME ?? '';
  readonly port = Number(process.env.PORT ?? 3000);

  constructor() {
    if (this.sessionSecret.length < 16) {
      throw new Error('SESSION_SECRET must be at least 16 characters');
    }
    if (!Number.isInteger(this.port) || this.port <= 0) {
      throw new Error('PORT must be a positive integer');
    }
  }
}
