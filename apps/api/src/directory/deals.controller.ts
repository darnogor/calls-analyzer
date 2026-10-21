import { Body, Controller, Param, Patch, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuthMode } from '../auth/auth.guard';
import { sourceFrom } from '../auth/source-tokens';
import { DirectoryService } from './directory.service';

@Controller('api/projects/:projectId/deals')
export class DealsController {
  constructor(private readonly directory: DirectoryService) {}

  @Patch('by-external-id/:externalId')
  @AuthMode('source')
  patchByExternalId(
    @Req() req: Request,
    @Param('projectId') projectId: string,
    @Param('externalId') externalId: string,
    @Body() body: unknown,
  ) {
    return this.directory.patchDeal(sourceFrom(req), projectId, externalId, body);
  }
}
