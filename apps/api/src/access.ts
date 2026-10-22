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

export type ProjectAction = 'read' | 'write' | 'problems' | 'settings';

@Injectable()
export class ProjectAccess {
  constructor(private readonly db: Database) {}

  async require(account: AuthAccount, projectId: string, action: ProjectAction): Promise<ProjectRecord> {
    if (!isUuid(projectId)) {
      throw new ApiError(404, { error: 'project_not_found' });
    }
    const row = await this.db.client.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true, timezone: true, min_call_duration_sec: true },
    });
    if (!row) {
      throw new ApiError(404, { error: 'project_not_found' });
    }
    let role: string | null = null;
    if (!account.is_administrator) {
      const membership = await this.db.client.projectMembership.findUnique({
        where: { account_id_project_id: { account_id: account.id, project_id: projectId } },
        select: { role: true },
      });
      role = membership?.role ?? null;
    }
    const decision = decideProjectAccess(account.is_administrator, role, action);
    if (decision === 'not_found') {
      throw new ApiError(404, { error: 'project_not_found' });
    }
    if (decision === 'forbidden') {
      throw new ApiError(403, { error: 'forbidden' });
    }
    return row;
  }
}

export function decideProjectAccess(
  isAdministrator: boolean,
  role: string | null,
  action: ProjectAction,
): 'ok' | 'not_found' | 'forbidden' {
  if (isAdministrator) {
    return 'ok';
  }
  if (!role) {
    return 'not_found';
  }
  if (action === 'read') {
    return 'ok';
  }
  if (action === 'settings') {
    return 'forbidden';
  }
  if (role === 'lead') {
    return 'ok';
  }
  return 'forbidden';
}

export function assertAdministrator(account: { is_administrator: boolean }): void {
  if (!account.is_administrator) {
    throw new ApiError(403, { error: 'forbidden' });
  }
}
