import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createPrisma, isUniqueViolation, type PrismaClient } from '@calls/db';
import { AppConfig } from '../config';

export { isUniqueViolation };

@Injectable()
export class Database implements OnModuleInit, OnModuleDestroy {
  readonly client: PrismaClient;

  constructor(config: AppConfig) {
    this.client = createPrisma(config.databaseUrl);
  }

  async onModuleInit(): Promise<void> {
    await this.client.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }

  // SQL that Prisma Client cannot express safely: dynamic filters, catalog reads, locks.
  async query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params: unknown[] = [],
  ): Promise<{ rows: T[]; rowCount: number }> {
    const rows = await this.client.$queryRawUnsafe<T[]>(text, ...params);
    return { rows, rowCount: rows.length };
  }
}
