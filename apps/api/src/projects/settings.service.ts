import { Injectable } from '@nestjs/common';
import type { AuthAccount } from '../auth/auth.guard';
import { ProjectAccess } from '../access';
import { Database, isUniqueViolation } from '../db/database';
import { ApiError } from '../errors';
import { loadCurrentStages } from './scorecard';
import { parseSettings, type SettingsBody } from './validate-settings';

@Injectable()
export class SettingsService {
  constructor(
    private readonly db: Database,
    private readonly access: ProjectAccess,
  ) {}

  async get(account: AuthAccount, projectId: string): Promise<SettingsBody> {
    const project = await this.access.require(account, projectId, 'settings');
    const stages = await loadCurrentStages(this.db, project.id);
    return {
      timezone: project.timezone,
      min_call_duration_sec: project.min_call_duration_sec,
      stages,
    };
  }

  async replace(account: AuthAccount, projectId: string, body: unknown): Promise<SettingsBody> {
    const project = await this.access.require(account, projectId, 'settings');
    const parsed = await parseSettings(body, this.db);
    if (!parsed.ok) {
      if (parsed.error === 'stage_set_is_fixed') {
        throw new ApiError(422, { error: 'stage_set_is_fixed' });
      }
      throw new ApiError(422, { error: 'invalid_settings', details: parsed.details });
    }
    const saved = parsed.value;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await this.db.tx(async (client) => {
          const current = await client.query<{ version: number }>(
            `select version
             from scorecards
             where project_id = $1
             order by version desc
             limit 1
             for update`,
            [project.id],
          );
          const version = current.rows[0]?.version;
          if (!version) {
            throw new Error(`scorecard missing for project ${project.id}`);
          }
          await client.query(
            `update projects
             set timezone = $2, min_call_duration_sec = $3
             where id = $1`,
            [project.id, saved.timezone, saved.min_call_duration_sec],
          );
          await client.query(
            `insert into scorecards (project_id, version, stages_json)
             values ($1, $2, $3::jsonb)`,
            [project.id, version + 1, JSON.stringify(saved.stages)],
          );
        });
        return saved;
      } catch (error) {
        if (attempt === 0 && isUniqueViolation(error)) {
          continue;
        }
        throw error;
      }
    }
    throw new Error('scorecard version conflict');
  }
}
