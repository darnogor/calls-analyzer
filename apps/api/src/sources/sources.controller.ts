import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { AuthedRequest } from '../auth/auth.guard';
import { Public } from '../auth/auth.guard';
import { SourcesService } from './sources.service';

@Controller('api/projects/:projectId/sources')
export class SourcesController {
  constructor(private readonly sources: SourcesService) {}

  @Get()
  list(@Req() req: AuthedRequest, @Param('projectId') projectId: string) {
    return this.sources.list(req.account, projectId);
  }

  @Post()
  create(@Req() req: AuthedRequest, @Param('projectId') projectId: string, @Body() body: unknown) {
    return this.sources.create(req.account, projectId, body);
  }
}

@Controller('api/source-setup')
export class SourceSetupController {
  constructor(private readonly sources: SourcesService) {}

  @Post('exchange')
  @Public()
  @HttpCode(200)
  exchange(@Body() body: unknown) {
    return this.sources.exchange(body);
  }
}
