import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { assertAdministrator } from '../access';
import type { AuthAccount } from '../auth/auth.guard';
import { hashPassword } from '../auth/password';
import { Database, isUniqueViolation, type Queryable } from '../db/database';
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

const ACCOUNT_SELECT = `
  select
    a.id,
    a.email,
    a.name,
    a.is_administrator,
    a.is_active,
    coalesce(
      jsonb_agg(
        jsonb_build_object('id', p.id, 'name', p.name, 'role', m.role)
        order by p.created_at asc, p.id asc
      ) filter (where p.id is not null),
      '[]'::jsonb
    ) as projects
  from accounts a
  left join project_memberships m on m.account_id = a.id
  left join projects p on p.id = m.project_id
`;

@Injectable()
export class AccountsService {
  constructor(private readonly db: Database) {}

  async list(account: AuthAccount): Promise<{ items: Record<string, unknown>[] }> {
    assertAdministrator(account);
    const result = await this.db.query<AccountRow>(
      `${ACCOUNT_SELECT}
       group by a.id
       order by a.created_at asc, a.id asc`,
    );
    return { items: result.rows.map(presentAccount) };
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
      await this.db.query(
        `insert into accounts (id, email, name, password_hash, is_administrator, is_active)
         values ($1, $2, $3, $4, $5, true)`,
        [id, parsed.email, parsed.name, passwordHash, parsed.is_administrator],
      );
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
    await this.db.tx(async (client) => {
      const current = await client.query<{
        email: string;
        name: string;
        is_administrator: boolean;
        is_active: boolean;
      }>(
        `select email, name, is_administrator, is_active
         from accounts
         where id = $1
         for update`,
        [accountId],
      );
      const row = current.rows[0];
      if (!row) {
        throw new ApiError(404, { error: 'account_not_found' });
      }
      const next = {
        email: patch.email ?? row.email,
        name: patch.name ?? row.name,
        is_administrator: patch.is_administrator ?? row.is_administrator,
        is_active: patch.is_active ?? row.is_active,
      };
      const others = await client.query<{ count: number }>(
        `select count(*)::int as count
         from accounts
         where is_administrator = true and is_active = true and id <> $1`,
        [accountId],
      );
      if (removesLastActiveAdministrator(row, next, others.rows[0]?.count ?? 0)) {
        throw new ApiError(409, { error: 'last_administrator' });
      }
      try {
        await client.query(
          `update accounts
           set email = $2,
               name = $3,
               is_administrator = $4,
               is_active = $5,
               password_hash = coalesce($6, password_hash),
               updated_at = now()
           where id = $1`,
          [accountId, next.email, next.name, next.is_administrator, next.is_active, passwordHash],
        );
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
    await this.db.tx(async (client) => {
      const existing = await client.query(`select id from accounts where id = $1 for update`, [accountId]);
      if (!existing.rowCount) {
        throw new ApiError(404, { error: 'account_not_found' });
      }
      await assertProjectsExist(client, items);
      await client.query(`delete from project_memberships where account_id = $1`, [accountId]);
      for (const item of items) {
        await client.query(
          `insert into project_memberships (id, account_id, project_id, role)
           values ($1, $2, $3, $4)`,
          [randomUUID(), accountId, item.project_id, item.role],
        );
      }
    });
    return this.requireAccount(accountId);
  }

  private async requireAccount(accountId: string): Promise<Record<string, unknown>> {
    const result = await this.db.query<AccountRow>(
      `${ACCOUNT_SELECT}
       where a.id = $1
       group by a.id`,
      [accountId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new ApiError(404, { error: 'account_not_found' });
    }
    return presentAccount(row);
  }
}

async function assertProjectsExist(client: Queryable, items: MembershipItem[]): Promise<void> {
  if (items.length === 0) {
    return;
  }
  for (const item of items) {
    if (!isUuid(item.project_id)) {
      throw new ApiError(404, { error: 'project_not_found' });
    }
    const found = await client.query(`select id from projects where id = $1`, [item.project_id]);
    if (!found.rowCount) {
      throw new ApiError(404, { error: 'project_not_found' });
    }
  }
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
