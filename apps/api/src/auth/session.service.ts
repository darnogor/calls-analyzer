import { Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { ApiError } from '../errors';
import { Database } from '../db/database';
import type { AuthAccount } from './auth.guard';
import { verifyPassword } from './password';
import { SessionTokens } from './session-tokens';

const SESSION_COOKIE = 'session';

@Injectable()
export class SessionService {
  constructor(
    private readonly db: Database,
    private readonly tokens: SessionTokens,
  ) {}

  async login(body: unknown, res: Response): Promise<void> {
    const record = asRecord(body);
    const email = typeof record?.email === 'string' ? record.email.trim().toLowerCase() : '';
    const password = typeof record?.password === 'string' ? record.password : '';
    if (!email || !password) {
      throw new ApiError(401, { error: 'unauthenticated' });
    }
    const result = await this.db.query<{ id: string; password_hash: string; is_active: boolean }>(
      `select id, password_hash, is_active from accounts where lower(email) = $1`,
      [email],
    );
    const account = result.rows[0];
    if (!account || !account.is_active || !(await verifyPassword(password, account.password_hash))) {
      throw new ApiError(401, { error: 'unauthenticated' });
    }
    this.setCookie(res, this.tokens.sign(account.id));
  }

  logout(res: Response): void {
    // TODO(docs): cookie lifetime and flags are not specified.
    // The value is an HMAC browser session cookie: HttpOnly, Secure, SameSite=Lax, no Max-Age.
    // There is no server-side revocation list. DELETE only clears the cookie.
    res.setHeader(
      'Set-Cookie',
      `${SESSION_COOKIE}=; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=0`,
    );
  }

  async me(account: AuthAccount): Promise<Record<string, unknown>> {
    const projects = account.is_administrator ? [] : await this.memberships(account.id);
    return {
      id: account.id,
      email: account.email,
      name: account.name,
      is_administrator: account.is_administrator,
      projects,
    };
  }

  private setCookie(res: Response, token: string): void {
    res.setHeader(
      'Set-Cookie',
      `${SESSION_COOKIE}=${token}; HttpOnly; Secure; Path=/; SameSite=Lax`,
    );
  }

  private async memberships(accountId: string): Promise<{ id: string; name: string; role: string }[]> {
    const result = await this.db.query<{ id: string; name: string; role: string }>(
      `select p.id, p.name, m.role
       from project_memberships m
       join projects p on p.id = m.project_id
       where m.account_id = $1
       order by p.created_at asc, p.id asc`,
      [accountId],
    );
    return result.rows;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}
