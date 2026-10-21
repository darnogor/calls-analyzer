import { Module } from '@nestjs/common';
import { AppConfig } from './config';
import { Database } from './db';
import { HealthController } from './health.controller';
import { Recordings } from './storage';
import { TranscribeWorker } from './worker';

@Module({
  controllers: [HealthController],
  providers: [AppConfig, Database, Recordings, TranscribeWorker],
})
export class AppModule {}
