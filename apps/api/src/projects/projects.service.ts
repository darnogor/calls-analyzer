import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AuthAccount } from '../auth/auth.guard';
import { Database } from '../db/database';
import { ApiError } from '../errors';
import { DEFAULT_MIN_CALL_DURATION_SEC, DEFAULT_STAGES, DEFAULT_TIMEZONE, MANUAL_SOURCE_NAME } from './defaults';

type ProjectListItem = {
  id: string;
  name: string;
  timezone: string;
};

@Injectable()
export class ProjectsService {
  constructor(private readonly db: Database) {}

  async list(account: AuthAccount): Promise<{ items: ProjectListItem[] }> {
    const result = account.is_administrator
      ? await this.db.query<ProjectListItem>(
          `select id, name, timezone from projects order by created_at asc, id asc`,
        )
      : await this.db.query<ProjectListItem>(
          `select p.id, p.name, p.timezone
           from projects p
           join project_memberships m on m.project_id = p.id
           where m.account_id = $1
           order by p.created_at asc, p.id asc`,
          [account.id],
        );
    return { items: result.rows };
  }

  async create(account: AuthAccount, body: unknown): Promise<{
    id: string;
    name: string;
    timezone: string;
    min_call_duration_sec: number;
  }> {
    if (!account.is_administrator) {
      throw new ApiError(403, { error: 'forbidden' });
    }
    const name = readProjectName(body);
    const id = randomUUID();
    const sourceId = randomUUID();
    await this.db.tx(async (client) => {
      await client.query(
        `insert into projects (id, name, timezone, min_call_duration_sec)
         values ($1, $2, $3, $4)`,
        [id, name, DEFAULT_TIMEZONE, DEFAULT_MIN_CALL_DURATION_SEC],
      );
      await client.query(
        `insert into sources (id, project_id, kind, provider, display_name)
         values ($1, $2, 'manual', null, $3)`,
        [sourceId, id, MANUAL_SOURCE_NAME],
      );
      await client.query(
        `insert into scorecards (project_id, version, stages_json)
         values ($1, 1, $2::jsonb)`,
        [id, JSON.stringify(DEFAULT_STAGES)],
      );
    });
    return {
      id,
      name,
      timezone: DEFAULT_TIMEZONE,
      min_call_duration_sec: DEFAULT_MIN_CALL_DURATION_SEC,
    };
  }
}

function readProjectName(body: unknown): string {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiError(422, { error: 'invalid_payload' });
  }
  const name = (body as { name?: unknown }).name;
  if (typeof name !== 'string' || name.trim() === '') {
    throw new ApiError(422, { error: 'invalid_payload' });
  }
  return name.trim();
}
