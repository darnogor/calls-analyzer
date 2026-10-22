import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createPrisma, isUniqueViolation, type PrismaClient } from '@calls/db';
import { AppConfig } from './config';

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
}
