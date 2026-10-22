import { Injectable } from '@nestjs/common';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

function optional(name: string): string {
  return process.env[name]?.trim() ?? '';
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
  readonly port = integer('PORT', 3000);
  readonly llmBaseUrl = optional('LLM_BASE_URL');
  readonly llmApiKey = optional('LLM_API_KEY');
  readonly llmModel = optional('LLM_MODEL');
  readonly llmTimeoutMs = integer('LLM_TIMEOUT_MS', 120_000);
  readonly concurrency = integer('ANALYZE_CONCURRENCY', 1);
}
