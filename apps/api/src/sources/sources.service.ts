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
    const rows = await this.db.client.source.findMany({
      where: { project_id: project.id },
      select: { id: true, kind: true, provider: true, display_name: true, last_intake_at: true, created_at: true },
    });
    rows.sort(
      (left, right) =>
        (left.kind === 'manual' ? 0 : 1) - (right.kind === 'manual' ? 0 : 1) ||
        left.created_at.getTime() - right.created_at.getTime() ||
        left.id.localeCompare(right.id),
    );
    return {
      items: rows.map((row) => ({
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
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    await this.db.client.source.create({
      data: {
        id,
        project_id: project.id,
        kind: 'plugin',
        provider: parsed.provider,
        display_name: parsed.display_name,
        setup_code_hash: secretHash(setupCode),
        setup_code_expires_at: expiresAt,
      },
    });
    return {
      source_id: id,
      setup_code: setupCode,
      expires_at: iso(expiresAt),
    };
  }

  async exchange(body: unknown): Promise<{ project_id: string; source_id: string; source_token: string }> {
    const setupCode = parseSetupCode(body);
    if (!setupCode) {
      throw new ApiError(422, { error: 'invalid_payload' });
    }
    const token = newSecret();
    return this.db.client.$transaction(async (tx) => {
      const rows = await tx.$queryRawUnsafe<
        Array<{ id: string; project_id: string; used_at: Date | null; expires_at: Date | null }>
      >(
        `select id,
                project_id,
                setup_code_used_at as used_at,
                setup_code_expires_at as expires_at
         from sources
         where setup_code_hash = $1
         for update`,
        secretHash(setupCode),
      );
      const row = rows[0];
      if (!row) {
        throw new ApiError(401, { error: 'setup_code_expired' });
      }
      if (row.used_at) {
        throw new ApiError(401, { error: 'setup_code_used' });
      }
      if (!row.expires_at || row.expires_at.getTime() <= Date.now()) {
        throw new ApiError(401, { error: 'setup_code_expired' });
      }
      await tx.source.update({
        where: { id: row.id },
        data: { token_hash: secretHash(token), setup_code_used_at: new Date() },
      });
      return {
        project_id: row.project_id,
        source_id: row.id,
        source_token: token,
      };
    });
  }
}
