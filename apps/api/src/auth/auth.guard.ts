import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ApiError } from '../errors';
import { Database } from '../db/database';
import { type AuthMode as AuthModeName, chooseAuth } from './bearer';
import { readCookie } from './session-token';
import { SessionTokens } from './session-tokens';
import { SourceTokens, type PluginSource } from './source-tokens';

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const AUTH_MODE = 'authMode';
export const AuthMode = (mode: AuthModeName) => SetMetadata(AUTH_MODE, mode);

export type AuthAccount = {
  id: string;
  email: string;
  name: string;
  is_administrator: boolean;
};

export type AuthedRequest = Request & { account: AuthAccount; source?: PluginSource };

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: SessionTokens,
    private readonly sources: SourceTokens,
    private readonly db: Database,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    const mode = this.reflector.getAllAndOverride<AuthModeName>(AUTH_MODE, [
      context.getHandler(),
      context.getClass(),
    ]);
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const choice = chooseAuth(Boolean(isPublic), mode, request.headers.authorization);
    if (choice === 'public') {
      return true;
    }
    if (choice === 'source') {
      request.source = await this.sources.authenticate(request.headers.authorization);
      return true;
    }
    const token = readCookie(request.headers.cookie, 'session');
    const accountId = token ? this.tokens.verify(token) : null;
    if (!accountId) {
      throw new ApiError(401, { error: 'unauthenticated' });
    }
    const account = await this.db.client.account.findFirst({
      where: { id: accountId, is_active: true },
      select: { id: true, email: true, name: true, is_administrator: true },
    });
    if (!account) {
      throw new ApiError(401, { error: 'unauthenticated' });
    }
    request.account = account;
    return true;
  }
}
