import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { assertAdministrator } from '../access';
import type { AuthAccount } from '../auth/auth.guard';
import { hashPassword } from '../auth/password';
import { isUniqueViolation, type TransactionClient } from '@calls/db';
import { Database } from '../db/database';
import { ApiError } from '../errors';
import { isUuid } from '../ids';
import {
  parseAccountPatch,
  parseMemberships,
  parseNewAccount,
  removesLastActiveAdministrator,
  type MembershipItem,
} from './validate-account';

type AccountRow = {
  id: string;
  email: string;
  name: string;
  is_administrator: boolean;
  is_active: boolean;
  projects: unknown;
};

const accountInclude = {
  memberships: {
    select: {
      role: true,
      project: { select: { id: true, name: true, created_at: true } },
    },
  },
} as const;

@Injectable()
export class AccountsService {
  constructor(private readonly db: Database) {}

  async list(account: AuthAccount): Promise<{ items: Record<string, unknown>[] }> {
    assertAdministrator(account);
    const rows = await this.db.client.account.findMany({
      orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
      include: accountInclude,
    });
    return { items: rows.map((row) => presentAccount(toAccountRow(row))) };
  }

  async create(account: AuthAccount, body: unknown): Promise<Record<string, unknown>> {
    assertAdministrator(account);
    const parsed = parseNewAccount(body);
    if (!parsed) {
      throw new ApiError(422, { error: 'invalid_payload' });
    }
    const id = randomUUID();
    const passwordHash = await hashPassword(parsed.password);
    try {
      await this.db.client.account.create({
        data: {
          id,
          email: parsed.email,
          name: parsed.name,
          password_hash: passwordHash,
          is_administrator: parsed.is_administrator,
          is_active: true,
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ApiError(409, { error: 'email_taken' });
      }
      throw error;
    }
    return this.requireAccount(id);
  }

  async update(account: AuthAccount, accountId: string, body: unknown): Promise<Record<string, unknown>> {
    assertAdministrator(account);
    if (!isUuid(accountId)) {
      throw new ApiError(404, { error: 'account_not_found' });
    }
    const patch = parseAccountPatch(body);
    if (!patch) {
      throw new ApiError(422, { error: 'invalid_payload' });
    }
    const passwordHash = patch.password ? await hashPassword(patch.password) : null;
    await this.db.client.$transaction(async (tx) => {
      const locked = await tx.$queryRawUnsafe<
        Array<{ email: string; name: string; is_administrator: boolean; is_active: boolean }>
      >(
        `select email, name, is_administrator, is_active
         from accounts
         where id = $1
         for update`,
        accountId,
      );
      const row = locked[0];
      if (!row) {
        throw new ApiError(404, { error: 'account_not_found' });
      }
      const next = {
        email: patch.email ?? row.email,
        name: patch.name ?? row.name,
        is_administrator: patch.is_administrator ?? row.is_administrator,
        is_active: patch.is_active ?? row.is_active,
      };
      const others = await tx.account.count({
        where: { is_administrator: true, is_active: true, id: { not: accountId } },
      });
      if (removesLastActiveAdministrator(row, next, others)) {
        throw new ApiError(409, { error: 'last_administrator' });
      }
      try {
        await tx.account.update({
          where: { id: accountId },
          data: {
            email: next.email,
            name: next.name,
            is_administrator: next.is_administrator,
            is_active: next.is_active,
            ...(passwordHash ? { password_hash: passwordHash } : {}),
            updated_at: new Date(),
          },
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ApiError(409, { error: 'email_taken' });
        }
        throw error;
      }
    });
    return this.requireAccount(accountId);
  }

  async replaceProjects(account: AuthAccount, accountId: string, body: unknown): Promise<Record<string, unknown>> {
    assertAdministrator(account);
    if (!isUuid(accountId)) {
      throw new ApiError(404, { error: 'account_not_found' });
    }
    const items = parseMemberships(body);
    if (!items) {
      throw new ApiError(422, { error: 'invalid_payload' });
    }
    await this.db.client.$transaction(async (tx) => {
      const existing = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `select id from accounts where id = $1 for update`,
        accountId,
      );
      if (!existing.length) {
        throw new ApiError(404, { error: 'account_not_found' });
      }
      await assertProjectsExist(tx, items);
      await tx.projectMembership.deleteMany({ where: { account_id: accountId } });
      if (items.length > 0) {
        await tx.projectMembership.createMany({
          data: items.map((item) => ({
            id: randomUUID(),
            account_id: accountId,
            project_id: item.project_id,
            role: item.role,
          })),
        });
      }
    });
    return this.requireAccount(accountId);
  }

  private async requireAccount(accountId: string): Promise<Record<string, unknown>> {
    const row = await this.db.client.account.findUnique({
      where: { id: accountId },
      include: accountInclude,
    });
    if (!row) {
      throw new ApiError(404, { error: 'account_not_found' });
    }
    return presentAccount(toAccountRow(row));
  }
}

async function assertProjectsExist(client: TransactionClient, items: MembershipItem[]): Promise<void> {
  if (items.length === 0) {
    return;
  }
  for (const item of items) {
    if (!isUuid(item.project_id)) {
      throw new ApiError(404, { error: 'project_not_found' });
    }
    const found = await client.project.findUnique({ where: { id: item.project_id }, select: { id: true } });
    if (!found) {
      throw new ApiError(404, { error: 'project_not_found' });
    }
  }
}

function toAccountRow(row: {
  id: string;
  email: string;
  name: string;
  is_administrator: boolean;
  is_active: boolean;
  memberships: Array<{ role: string; project: { id: string; name: string; created_at: Date } }>;
}): AccountRow {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    is_administrator: row.is_administrator,
    is_active: row.is_active,
    projects: [...row.memberships]
      .sort(
        (left, right) =>
          left.project.created_at.getTime() - right.project.created_at.getTime() ||
          left.project.id.localeCompare(right.project.id),
      )
      .map((membership) => ({
        id: membership.project.id,
        name: membership.project.name,
        role: membership.role,
      })),
  };
}

function presentAccount(row: AccountRow): Record<string, unknown> {
  const projects = Array.isArray(row.projects) ? row.projects : [];
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    is_administrator: row.is_administrator,
    is_active: row.is_active,
    projects: projects.map((item) => {
      const project = item as { id?: unknown; name?: unknown; role?: unknown };
      return {
        id: project.id,
        name: project.name,
        role: project.role,
      };
    }),
  };
}
