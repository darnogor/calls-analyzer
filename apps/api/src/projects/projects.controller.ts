import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import type { AuthedRequest } from '../auth/auth.guard';
import { ProjectsService } from './projects.service';

@Controller('api/projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list(@Req() req: AuthedRequest) {
    return this.projects.list(req.account);
  }

  @Post()
  create(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.projects.create(req.account, body);
  }
}
