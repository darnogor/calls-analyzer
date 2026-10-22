import { Injectable } from '@nestjs/common';
import { AppConfig } from '../config';
import { signSession, verifySession } from './session-token';

@Injectable()
export class SessionTokens {
  constructor(private readonly config: AppConfig) {}

  sign(accountId: string): string {
    return signSession(accountId, this.config.sessionSecret);
  }

  verify(token: string): string | null {
    return verifySession(token, this.config.sessionSecret);
  }
}
