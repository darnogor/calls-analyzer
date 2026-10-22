import { Injectable } from '@nestjs/common';
import type { AuthAccount } from '../auth/auth.guard';
import type { PluginSource } from '../auth/source-tokens';
import { SourceTokens } from '../auth/source-tokens';
import { ProjectAccess } from '../access';
import { Prisma, isUniqueViolation } from '@calls/db';
import { Database } from '../db/database';
import { ApiError } from '../errors';
import { loadCurrentStages } from './scorecard';
import { parseSettings, type SettingsBody } from './validate-settings';

export function presentMinCallDuration(minCallDurationSec: number): { min_call_duration_sec: number } {
  return { min_call_duration_sec: minCallDurationSec };
}

@Injectable()
export class SettingsService {
  constructor(
    private readonly db: Database,
    private readonly access: ProjectAccess,
    private readonly sourceTokens: SourceTokens,
  ) {}

  async minCallDuration(source: PluginSource, projectId: string): Promise<{ min_call_duration_sec: number }> {
    const project = await this.sourceTokens.requireProject(source, projectId);
    return presentMinCallDuration(project.min_call_duration_sec);
  }

  async get(account: AuthAccount, projectId: string): Promise<SettingsBody> {
    const project = await this.access.require(account, projectId, 'settings');
    const stages = await loadCurrentStages(this.db.client, project.id);
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
        await this.db.client.$transaction(async (tx) => {
          const current = await tx.$queryRawUnsafe<Array<{ version: number }>>(
            `select version
             from scorecards
             where project_id = $1
             order by version desc
             limit 1
             for update`,
            project.id,
          );
          const version = current[0]?.version;
          if (!version) {
            throw new Error(`scorecard missing for project ${project.id}`);
          }
          await tx.project.update({
            where: { id: project.id },
            data: { timezone: saved.timezone, min_call_duration_sec: saved.min_call_duration_sec },
          });
          await tx.scorecard.create({
            data: {
              project_id: project.id,
              version: version + 1,
              stages_json: saved.stages as unknown as Prisma.InputJsonValue,
            },
          });
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
