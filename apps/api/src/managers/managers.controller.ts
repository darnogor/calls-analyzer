import { Body, Controller, Get, Param, Patch, Query, Req } from '@nestjs/common';
import type { AuthedRequest } from '../auth/auth.guard';
import { ManagersService } from './managers.service';

@Controller('api/projects/:projectId/managers')
export class ManagersController {
  constructor(private readonly managers: ManagersService) {}

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
