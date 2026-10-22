import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from './auth/auth.guard';

@Controller()
export class HealthController {
  // TODO(docs): the liveness path is not specified. Each app container answers GET /health.
  @Get('health')
  @Public()
  health(@Res() res: Response): void {
    res.type('text/plain').send('ok');
  }
}
