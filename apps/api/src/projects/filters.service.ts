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
    const [managers, deals, stages] = await Promise.all([
      this.db.query<{ id: string; name: string }>(
        `select id, name
         from managers
         where project_id = $1 and is_active = true`,
        [project.id],
      ),
      this.db.query<{ status: string }>(
        `select distinct btrim(current_deal_status_name) as status
         from calls
         where project_id = $1
           and current_deal_status_name is not null
           and btrim(current_deal_status_name) <> ''`,
        [project.id],
      ),
      loadCurrentStages(this.db, project.id),
    ]);
    return {
      managers: [...managers.rows]
        .sort((left, right) => left.name.localeCompare(right.name, 'ru') || left.id.localeCompare(right.id))
        .map((row) => ({ id: row.id, name: row.name })),
      deal_statuses: deals.rows.map((row) => row.status).sort((left, right) => left.localeCompare(right, 'ru')),
      stages: stages.map((stage) => ({ key: stage.key, title: stage.title })),
    };
  }
}
