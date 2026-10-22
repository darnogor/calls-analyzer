import { Injectable } from '@nestjs/common';
import type { AuthAccount } from '../auth/auth.guard';
import { ProjectAccess } from '../access';
import { requestedAction } from '../calls/list-query';
import { CallsService } from '../calls/calls.service';
import { Database } from '../db/database';
import { ApiError } from '../errors';
import { isUuid } from '../ids';
import { loadCurrentStages, type Stage } from '../projects/scorecard';
import { parseManagerName, parseManagerQuery } from './manager-query';
import { aggregateManagers, sortManagers, type ManagerCallRow, type ManagerItem } from './present-manager';

const MANAGER_CALLS = `
  select
    m.id,
    m.name,
    m.email,
    m.is_active,
    s.kind as source_kind,
    s.provider as source_provider,
    c.started_at,
    ca.overall_score,
    ca.stages_json
  from managers m
  join sources s on s.id = m.source_id
  join projects p on p.id = m.project_id
  left join calls c
    on c.manager_id = m.id
   and c.project_id = m.project_id
   and c.processing_status = 'completed'
   and ($2::date is null or (c.started_at at time zone p.timezone) >= $2::timestamp)
   and ($3::date is null or (c.started_at at time zone p.timezone) < ($3::date + interval '1 day'))
  left join call_analysis ca on ca.call_id = c.id
  where m.project_id = $1
    and ($4::uuid is null or m.id = $4::uuid)
`;

@Injectable()
export class ManagersService {
  constructor(
    private readonly db: Database,
    private readonly access: ProjectAccess,
    private readonly calls: CallsService,
  ) {}

  async list(account: AuthAccount, projectId: string, query: Record<string, unknown>) {
    const project = await this.access.require(account, projectId, 'read');
    const stages = await loadCurrentStages(this.db.client, project.id);
    const parsed = parseManagerQuery(query, stages.map((stage) => stage.key));
    const rows = await this.loadRows(project.id, parsed.dateFrom ?? null, parsed.dateTo ?? null, null);
    const items = sortManagers(
      aggregateManagers(rows, stages, { includeEmail: false, dropInactiveWithoutCalls: true }),
      parsed.sort,
      parsed.order,
    );
    return {
      date_from: parsed.dateFrom ?? null,
      date_to: parsed.dateTo ?? null,
      items,
    };
  }

  async get(account: AuthAccount, projectId: string, managerId: string, query: Record<string, unknown>) {
    const project = await this.access.require(account, projectId, 'read');
    const stages = await loadCurrentStages(this.db.client, project.id);
    const parsed = parseManagerQuery(query, stages.map((stage) => stage.key));
    const item = await this.one(project.id, managerId, stages, parsed.dateFrom ?? null, parsed.dateTo ?? null);
    return item;
  }

  async callsFor(
    account: AuthAccount,
    projectId: string,
    managerId: string,
    query: Record<string, unknown>,
  ) {
    const project = await this.access.require(account, projectId, requestedAction(query));
    if (!isUuid(managerId)) {
      throw new ApiError(404, { error: 'manager_not_found' });
    }
    const found = await this.db.client.manager.findFirst({
      where: { id: managerId, project_id: project.id },
      select: { id: true },
    });
    if (!found) {
      throw new ApiError(404, { error: 'manager_not_found' });
    }
    return this.calls.list(account, projectId, { ...query, manager_id: managerId });
  }

  async rename(account: AuthAccount, projectId: string, managerId: string, body: unknown): Promise<ManagerItem> {
    const project = await this.access.require(account, projectId, 'write');
    const name = parseManagerName(body);
    if (!name) {
      throw new ApiError(422, { error: 'invalid_payload' });
    }
    if (!isUuid(managerId)) {
      throw new ApiError(404, { error: 'manager_not_found' });
    }
    const current = await this.db.client.manager.findFirst({
      where: { id: managerId, project_id: project.id },
      select: { source: { select: { kind: true } } },
    });
    if (!current) {
      throw new ApiError(404, { error: 'manager_not_found' });
    }
    if (current.source.kind === 'plugin') {
      throw new ApiError(409, { error: 'manager_owned_by_plugin' });
    }
    await this.db.client.manager.update({
      where: { id: managerId },
      data: { name, updated_at: new Date() },
    });
    const stages = await loadCurrentStages(this.db.client, project.id);
    return this.one(project.id, managerId, stages, null, null);
  }

  private async one(
    projectId: string,
    managerId: string,
    stages: Stage[],
    dateFrom: string | null,
    dateTo: string | null,
  ): Promise<ManagerItem> {
    if (!isUuid(managerId)) {
      throw new ApiError(404, { error: 'manager_not_found' });
    }
    const rows = await this.loadRows(projectId, dateFrom, dateTo, managerId);
    const item = aggregateManagers(rows, stages, { includeEmail: true, dropInactiveWithoutCalls: false })[0];
    if (!item) {
      throw new ApiError(404, { error: 'manager_not_found' });
    }
    return item;
  }

  private async loadRows(
    projectId: string,
    dateFrom: string | null,
    dateTo: string | null,
    managerId: string | null,
  ): Promise<ManagerCallRow[]> {
    const result = await this.db.query<ManagerCallRow>(MANAGER_CALLS, [projectId, dateFrom, dateTo, managerId]);
    return result.rows;
  }
}
