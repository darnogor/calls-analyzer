import { Prisma } from '@calls/db';
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
    if (account.is_administrator) {
      const rows = await this.db.client.project.findMany({
        orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
        select: { id: true, name: true, timezone: true },
      });
      return { items: rows };
    }
    const memberships = await this.db.client.projectMembership.findMany({
      where: { account_id: account.id },
      select: { project: { select: { id: true, name: true, timezone: true, created_at: true } } },
    });
    const items = memberships
      .map((row) => row.project)
      .sort((left, right) => left.created_at.getTime() - right.created_at.getTime() || left.id.localeCompare(right.id))
      .map(({ id, name, timezone }) => ({ id, name, timezone }));
    return { items };
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
    await this.db.client.$transaction(async (tx) => {
      await tx.project.create({
        data: {
          id,
          name,
          timezone: DEFAULT_TIMEZONE,
          min_call_duration_sec: DEFAULT_MIN_CALL_DURATION_SEC,
        },
      });
      await tx.source.create({
        data: {
          id: sourceId,
          project_id: id,
          kind: 'manual',
          provider: null,
          display_name: MANUAL_SOURCE_NAME,
        },
      });
      await tx.scorecard.create({
        data: {
          project_id: id,
          version: 1,
          stages_json: DEFAULT_STAGES as unknown as Prisma.InputJsonValue,
        },
      });
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
