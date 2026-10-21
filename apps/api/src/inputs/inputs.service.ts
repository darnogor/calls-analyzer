import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AuthAccount } from '../auth/auth.guard';
import { ProjectAccess } from '../access';
import { Database } from '../db/database';
import { ApiError } from '../errors';
import { isUuid } from '../ids';
import { iso } from '../time';
import { parseScript } from './validate-script';

type InputRow = {
  id: string;
  title: string;
  body: string;
  updated_at: Date | string;
};

@Injectable()
export class InputsService {
  constructor(
    private readonly db: Database,
    private readonly access: ProjectAccess,
  ) {}

  async list(account: AuthAccount, projectId: string): Promise<{ items: Record<string, unknown>[] }> {
    const project = await this.access.require(account, projectId, 'write');
    const result = await this.db.query<InputRow>(
      `select id, title, body, updated_at
       from project_inputs
       where project_id = $1
       order by updated_at asc, id asc`,
      [project.id],
    );
    return { items: result.rows.map(presentInput) };
  }

  async create(account: AuthAccount, projectId: string, body: unknown): Promise<Record<string, unknown>> {
    const project = await this.access.require(account, projectId, 'write');
    const parsed = parseScript(body);
    if (!parsed) {
      throw new ApiError(422, { error: 'invalid_input' });
    }
    const result = await this.db.query<InputRow>(
      `insert into project_inputs (id, project_id, title, body)
       values ($1, $2, $3, $4)
       returning id, title, body, updated_at`,
      [randomUUID(), project.id, parsed.title, parsed.body],
    );
    return presentInput(result.rows[0]!);
  }

  async update(
    account: AuthAccount,
    projectId: string,
    inputId: string,
    body: unknown,
  ): Promise<Record<string, unknown>> {
    const project = await this.access.require(account, projectId, 'write');
    if (!isUuid(inputId)) {
      throw new ApiError(404, { error: 'input_not_found' });
    }
    const parsed = parseScript(body);
    if (!parsed) {
      throw new ApiError(422, { error: 'invalid_input' });
    }
    const result = await this.db.query<InputRow>(
      `update project_inputs
       set title = $3, body = $4, updated_at = now()
       where id = $1 and project_id = $2
       returning id, title, body, updated_at`,
      [inputId, project.id, parsed.title, parsed.body],
    );
    const row = result.rows[0];
    if (!row) {
      throw new ApiError(404, { error: 'input_not_found' });
    }
    return presentInput(row);
  }

  async remove(account: AuthAccount, projectId: string, inputId: string): Promise<void> {
    const project = await this.access.require(account, projectId, 'write');
    if (!isUuid(inputId)) {
      throw new ApiError(404, { error: 'input_not_found' });
    }
    const result = await this.db.query(
      `delete from project_inputs where id = $1 and project_id = $2`,
      [inputId, project.id],
    );
    if (!result.rowCount) {
      throw new ApiError(404, { error: 'input_not_found' });
    }
  }
}

function presentInput(row: InputRow): Record<string, unknown> {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    updated_at: iso(row.updated_at),
  };
}
