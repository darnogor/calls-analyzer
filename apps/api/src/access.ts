import { Injectable } from '@nestjs/common';
import type { AuthAccount } from './auth/auth.guard';
import { Database } from './db/database';
import { ApiError } from './errors';
import { isUuid } from './ids';

export type ProjectRecord = {
  id: string;
  name: string;
  timezone: string;
  min_call_duration_sec: number;
};

export type ProjectAction = 'read' | 'write' | 'problems';

@Injectable()
export class ProjectAccess {
  constructor(private readonly db: Database) {}

  async require(account: AuthAccount, projectId: string, action: ProjectAction): Promise<ProjectRecord> {
    if (!isUuid(projectId)) {
      throw new ApiError(404, { error: 'project_not_found' });
    }
    const project = await this.db.query<ProjectRecord>(
      `select id, name, timezone, min_call_duration_sec from projects where id = $1`,
      [projectId],
    );
    const row = project.rows[0];
    if (!row) {
      throw new ApiError(404, { error: 'project_not_found' });
    }
    if (account.is_administrator) {
      return row;
    }
    const membership = await this.db.query<{ role: string }>(
      `select role from project_memberships where account_id = $1 and project_id = $2`,
      [account.id, projectId],
    );
    const role = membership.rows[0]?.role;
    if (!role) {
      throw new ApiError(404, { error: 'project_not_found' });
    }
    if (action === 'read' || role === 'lead') {
      return row;
    }
    throw new ApiError(403, { error: 'forbidden' });
  }
}
