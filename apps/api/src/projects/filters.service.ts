import { Injectable } from '@nestjs/common';
import type { AuthAccount } from '../auth/auth.guard';
import { ProjectAccess } from '../access';
import { Database } from '../db/database';
import { loadCurrentStages } from './scorecard';

@Injectable()
export class FiltersService {
  constructor(
    private readonly db: Database,
    private readonly access: ProjectAccess,
  ) {}

  async get(account: AuthAccount, projectId: string): Promise<{
    managers: { id: string; name: string }[];
    deal_statuses: string[];
    stages: { key: string; title: string }[];
  }> {
    const project = await this.access.require(account, projectId, 'read');
    const [managers, deals, directory, stages] = await Promise.all([
      this.db.client.manager.findMany({
        where: { project_id: project.id, is_active: true },
        select: { id: true, name: true },
      }),
      this.db.query<{ status: string }>(
        `select distinct btrim(current_deal_status_name) as status
         from calls
         where project_id = $1
           and current_deal_status_name is not null
           and btrim(current_deal_status_name) <> ''`,
        [project.id],
      ),
      this.db.client.dealStage.findMany({
        where: { project_id: project.id },
        orderBy: [{ position: 'asc' }, { name: 'asc' }],
        select: { name: true },
      }),
      loadCurrentStages(this.db.client, project.id),
    ]);
    const listed = new Set(directory.map((stage) => stage.name));
    const extra = deals.rows
      .map((row) => row.status)
      .filter((status) => !listed.has(status))
      .sort((left, right) => left.localeCompare(right, 'ru'));
    const dealStatuses = directory.length > 0
      ? [...directory.map((stage) => stage.name), ...extra]
      : deals.rows.map((row) => row.status).sort((left, right) => left.localeCompare(right, 'ru'));
    return {
      managers: [...managers]
        .sort((left, right) => left.name.localeCompare(right.name, 'ru') || left.id.localeCompare(right.id))
        .map((row) => ({ id: row.id, name: row.name })),
      deal_statuses: dealStatuses,
      stages: stages.map((stage) => ({ key: stage.key, title: stage.title })),
    };
  }
}
