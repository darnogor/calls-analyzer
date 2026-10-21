import { Body, Controller, Delete, Get, Param, Patch, Post, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { AuthedRequest } from '../auth/auth.guard';
import { InputsService } from './inputs.service';

@Controller('api/projects/:projectId/inputs')
export class InputsController {
  constructor(private readonly inputs: InputsService) {}

  @Get()
  list(@Req() req: AuthedRequest, @Param('projectId') projectId: string) {
    return this.inputs.list(req.account, projectId);
  }

  @Post()
  create(@Req() req: AuthedRequest, @Param('projectId') projectId: string, @Body() body: unknown) {
    return this.inputs.create(req.account, projectId, body);
  }

  @Patch(':inputId')
  update(
    @Req() req: AuthedRequest,
    @Param('projectId') projectId: string,
    @Param('inputId') inputId: string,
    @Body() body: unknown,
  ) {
    return this.inputs.update(req.account, projectId, inputId, body);
  }

  @Delete(':inputId')
  async remove(
    @Req() req: AuthedRequest,
    @Param('projectId') projectId: string,
    @Param('inputId') inputId: string,
    @Res() res: Response,
  ): Promise<void> {
    await this.inputs.remove(req.account, projectId, inputId);
    res.status(204).end();
  }
}
