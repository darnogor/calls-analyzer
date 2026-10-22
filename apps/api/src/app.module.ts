import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ProjectAccess } from './access';
import { AuthGuard } from './auth/auth.guard';
import { BootstrapService } from './auth/bootstrap';
import { SessionController } from './auth/session.controller';
import { SessionService } from './auth/session.service';
import { SessionTokens } from './auth/session-tokens';
import { CallsController } from './calls/calls.controller';
import { CallsService } from './calls/calls.service';
import { AppConfig } from './config';
import { Database } from './db/database';
import { HealthController } from './health.controller';
import { ProjectsController } from './projects/projects.controller';
import { ProjectsService } from './projects/projects.service';
import { AudioQueue } from './queue/audio-queue';
import { Recordings } from './storage/recordings';

@Module({
  controllers: [HealthController, SessionController, ProjectsController, CallsController],
  providers: [
    AppConfig,
    Database,
    AudioQueue,
    Recordings,
    SessionTokens,
    BootstrapService,
    SessionService,
    ProjectsService,
    CallsService,
    ProjectAccess,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
