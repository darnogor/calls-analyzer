import { Module } from '@nestjs/common';
import { AnalyzeWorker } from './worker';
import { AppConfig } from './config';
import { Database } from './db';
import { HealthController } from './health.controller';

@Module({
  controllers: [HealthController],
  providers: [AppConfig, Database, AnalyzeWorker],
})
export class AppModule {}
