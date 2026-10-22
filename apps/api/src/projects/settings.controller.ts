import { Body, Controller, Get, Param, Put, Req } from '@nestjs/common';
import type { AuthedRequest } from '../auth/auth.guard';
import { FiltersService } from './filters.service';
import { SettingsService } from './settings.service';

@Controller('api/projects')
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly filters: FiltersService,
  ) {}

  @Get(':projectId/settings')
  get(@Req() req: AuthedRequest, @Param('projectId') projectId: string) {
    return this.settings.get(req.account, projectId);
  }

  @Put(':projectId/settings')
  replace(@Req() req: AuthedRequest, @Param('projectId') projectId: string, @Body() body: unknown) {
    return this.settings.replace(req.account, projectId, body);
  }

  @Get(':projectId/filters')
  filtersOf(@Req() req: AuthedRequest, @Param('projectId') projectId: string) {
    return this.filters.get(req.account, projectId);
  }
}
