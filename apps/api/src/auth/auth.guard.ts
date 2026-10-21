import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ApiError } from '../errors';
import { Database } from '../db/database';
import { readCookie } from './session-token';
import { SessionTokens } from './session-tokens';

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

export type AuthAccount = {
  id: string;
  email: string;
  name: string;
  is_administrator: boolean;
};

export type AuthedRequest = Request & { account: AuthAccount };

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: SessionTokens,
    private readonly db: Database,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const token = readCookie(request.headers.cookie, 'session');
    const accountId = token ? this.tokens.verify(token) : null;
    if (!accountId) {
      throw new ApiError(401, { error: 'unauthenticated' });
    }
    const result = await this.db.query<AuthAccount>(
      `select id, email, name, is_administrator
       from accounts
       where id = $1 and is_active = true`,
      [accountId],
    );
    const account = result.rows[0];
    if (!account) {
      throw new ApiError(401, { error: 'unauthenticated' });
    }
    request.account = account;
    return true;
  }
}
