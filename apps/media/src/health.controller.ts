import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';

@Controller()
export class HealthController {
  @Get('health')
  health(@Res() res: Response): void {
    res.type('text/plain').send('ok');
  }
}
