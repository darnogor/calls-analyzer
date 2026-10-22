import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AccountsController } from './accounts/accounts.controller';
import { AccountsService } from './accounts/accounts.service';
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
import { InputsController } from './inputs/inputs.controller';
import { InputsService } from './inputs/inputs.service';
import { ManagersController } from './managers/managers.controller';
import { ManagersService } from './managers/managers.service';
import { FiltersService } from './projects/filters.service';
import { ProjectsController } from './projects/projects.controller';
import { ProjectsService } from './projects/projects.service';
import { SettingsController } from './projects/settings.controller';
import { SettingsService } from './projects/settings.service';
import { AudioQueue } from './queue/audio-queue';
import { SourceSetupController, SourcesController } from './sources/sources.controller';
import { SourcesService } from './sources/sources.service';
import { Recordings } from './storage/recordings';

@Module({
  controllers: [
    HealthController,
    SessionController,
    AccountsController,
    ProjectsController,
    SettingsController,
    InputsController,
    SourcesController,
    SourceSetupController,
    ManagersController,
    CallsController,
  ],
  providers: [
    AppConfig,
    Database,
    AudioQueue,
    Recordings,
    SessionTokens,
    BootstrapService,
    SessionService,
    AccountsService,
    ProjectsService,
    SettingsService,
    FiltersService,
    InputsService,
    SourcesService,
    ManagersService,
    CallsService,
    ProjectAccess,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
