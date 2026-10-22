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
    const account = await this.db.client.account.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: { id: true, password_hash: true, is_active: true },
    });
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
    const rows = await this.db.client.projectMembership.findMany({
      where: { account_id: accountId },
      select: {
        role: true,
        project: { select: { id: true, name: true, created_at: true } },
      },
    });
    return rows
      .sort(
        (left, right) =>
          left.project.created_at.getTime() - right.project.created_at.getTime() ||
          left.project.id.localeCompare(right.project.id),
      )
      .map((row) => ({ id: row.project.id, name: row.project.name, role: row.role }));
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}
