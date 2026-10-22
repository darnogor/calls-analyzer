import { Body, Controller, Delete, Get, Post, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AuthedRequest, Public } from './auth.guard';
import { SessionService } from './session.service';

@Controller('api')
export class SessionController {
  constructor(private readonly sessions: SessionService) {}

  @Post('session')
  @Public()
  async login(@Body() body: unknown, @Res() res: Response): Promise<void> {
    await this.sessions.login(body, res);
    res.status(204).end();
  }

  @Delete('session')
  @Public()
  logout(@Res() res: Response): void {
    this.sessions.logout(res);
    res.status(204).end();
  }

  @Get('me')
  me(@Req() req: AuthedRequest): Promise<Record<string, unknown>> {
    return this.sessions.me(req.account);
  }
}
