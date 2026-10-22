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
    const rows = await this.db.client.projectInput.findMany({
      where: { project_id: project.id },
      orderBy: [{ updated_at: 'asc' }, { id: 'asc' }],
      select: { id: true, title: true, body: true, updated_at: true },
    });
    return { items: rows.map(presentInput) };
  }

  async create(account: AuthAccount, projectId: string, body: unknown): Promise<Record<string, unknown>> {
    const project = await this.access.require(account, projectId, 'write');
    const parsed = parseScript(body);
    if (!parsed) {
      throw new ApiError(422, { error: 'invalid_input' });
    }
    const row = await this.db.client.projectInput.create({
      data: { id: randomUUID(), project_id: project.id, title: parsed.title, body: parsed.body },
      select: { id: true, title: true, body: true, updated_at: true },
    });
    return presentInput(row);
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
    const updated = await this.db.client.projectInput.updateMany({
      where: { id: inputId, project_id: project.id },
      data: { title: parsed.title, body: parsed.body, updated_at: new Date() },
    });
    if (!updated.count) {
      throw new ApiError(404, { error: 'input_not_found' });
    }
    const row = await this.db.client.projectInput.findUnique({
      where: { id: inputId },
      select: { id: true, title: true, body: true, updated_at: true },
    });
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
    const removed = await this.db.client.projectInput.deleteMany({
      where: { id: inputId, project_id: project.id },
    });
    if (!removed.count) {
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
