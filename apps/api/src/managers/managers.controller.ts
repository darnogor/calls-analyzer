import { Body, Controller, Get, Param, Patch, Put, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuthMode, type AuthedRequest } from '../auth/auth.guard';
import { sourceFrom } from '../auth/source-tokens';
import { DirectoryService } from '../directory/directory.service';
import { ManagersService } from './managers.service';

@Controller('api/projects/:projectId/managers')
export class ManagersController {
  constructor(
    private readonly managers: ManagersService,
    private readonly directory: DirectoryService,
  ) {}

  @Put()
  @AuthMode('source')
  sync(@Req() req: Request, @Param('projectId') projectId: string, @Body() body: unknown) {
    return this.directory.syncManagers(sourceFrom(req), projectId, body);
  }

  @Get()
  list(
    @Req() req: AuthedRequest,
    @Param('projectId') projectId: string,
    @Query() query: Record<string, unknown>,
  ) {
    return this.managers.list(req.account, projectId, query);
  }

  @Get(':managerId/calls')
  calls(
    @Req() req: AuthedRequest,
    @Param('projectId') projectId: string,
    @Param('managerId') managerId: string,
    @Query() query: Record<string, unknown>,
  ) {
    return this.managers.callsFor(req.account, projectId, managerId, query);
  }

  @Get(':managerId')
  get(
    @Req() req: AuthedRequest,
    @Param('projectId') projectId: string,
    @Param('managerId') managerId: string,
    @Query() query: Record<string, unknown>,
  ) {
    return this.managers.get(req.account, projectId, managerId, query);
  }

  @Patch(':managerId')
  rename(
    @Req() req: AuthedRequest,
    @Param('projectId') projectId: string,
    @Param('managerId') managerId: string,
    @Body() body: unknown,
  ) {
    return this.managers.rename(req.account, projectId, managerId, body);
  }
}
