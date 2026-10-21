import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AuthAccount } from '../auth/auth.guard';
import { ProjectAccess } from '../access';
import { Database } from '../db/database';
import { ApiError } from '../errors';
import { iso } from '../time';
import { newSecret, secretHash } from './secrets';
import { parseNewSource, parseSetupCode } from './validate-source';

type SourceRow = {
  id: string;
  kind: string;
  provider: string | null;
  display_name: string;
  last_intake_at: Date | string | null;
};

@Injectable()
export class SourcesService {
  constructor(
    private readonly db: Database,
    private readonly access: ProjectAccess,
  ) {}

  async list(account: AuthAccount, projectId: string): Promise<{ items: Record<string, unknown>[] }> {
    const project = await this.access.require(account, projectId, 'write');
    const result = await this.db.query<SourceRow>(
      `select id, kind, provider, display_name, last_intake_at
       from sources
       where project_id = $1
       order by case when kind = 'manual' then 0 else 1 end, created_at asc, id asc`,
      [project.id],
    );
    return {
      items: result.rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        provider: row.provider,
        display_name: row.display_name,
        last_intake_at: iso(row.last_intake_at),
      })),
    };
  }

  async create(account: AuthAccount, projectId: string, body: unknown): Promise<Record<string, unknown>> {
    const project = await this.access.require(account, projectId, 'write');
    const parsed = parseNewSource(body);
    if (!parsed) {
      throw new ApiError(422, { error: 'invalid_payload' });
    }
    const id = randomUUID();
    const setupCode = newSecret();
    const result = await this.db.query<{ expires_at: Date }>(
      `insert into sources (
         id, project_id, kind, provider, display_name, setup_code_hash, setup_code_expires_at
       ) values ($1, $2, 'plugin', $3, $4, $5, now() + interval '15 minutes')
       returning setup_code_expires_at as expires_at`,
      [id, project.id, parsed.provider, parsed.display_name, secretHash(setupCode)],
    );
    return {
      source_id: id,
      setup_code: setupCode,
      expires_at: iso(result.rows[0]?.expires_at),
    };
  }

  async exchange(body: unknown): Promise<{ project_id: string; source_id: string; source_token: string }> {
    const setupCode = parseSetupCode(body);
    if (!setupCode) {
      throw new ApiError(422, { error: 'invalid_payload' });
    }
    const token = newSecret();
    return this.db.tx(async (client) => {
      const result = await client.query<{
        id: string;
        project_id: string;
        used_at: Date | null;
        expired: boolean;
      }>(
        `select id,
                project_id,
                setup_code_used_at as used_at,
                setup_code_expires_at <= now() as expired
         from sources
         where setup_code_hash = $1
         for update`,
        [secretHash(setupCode)],
      );
      const row = result.rows[0];
      if (!row) {
        throw new ApiError(401, { error: 'setup_code_expired' });
      }
      if (row.used_at) {
        throw new ApiError(401, { error: 'setup_code_used' });
      }
      if (row.expired) {
        throw new ApiError(401, { error: 'setup_code_expired' });
      }
      await client.query(
        `update sources
         set token_hash = $2, setup_code_used_at = now()
         where id = $1`,
        [row.id, secretHash(token)],
      );
      return {
        project_id: row.project_id,
        source_id: row.id,
        source_token: token,
      };
    });
  }
}
