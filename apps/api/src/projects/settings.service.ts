import { Injectable } from '@nestjs/common';
import type { AuthAccount } from '../auth/auth.guard';
import type { PluginSource } from '../auth/source-tokens';
import { SourceTokens } from '../auth/source-tokens';
import { ProjectAccess } from '../access';
import { Prisma, isUniqueViolation } from '@calls/db';
import { Database } from '../db/database';
import { ApiError } from '../errors';
import { loadCurrentStages } from './scorecard';
import { parseSettings, parseTextSetting, type SettingsBody } from './validate-settings';

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

  async get(account: AuthAccount, projectId: string): Promise<SettingsBody & {
    card_key: string | null;
    scoring_prompt: string;
    product_facts: string;
  }> {
    const project = await this.access.require(account, projectId, 'settings');
    const [stages, card, prompt, facts] = await Promise.all([
      loadCurrentStages(this.db.client, project.id),
      this.db.client.scorecard.findFirst({
        where: { project_id: project.id },
        orderBy: { version: 'desc' },
        select: { card_key: true },
      }),
      this.db.client.scoringPrompt.findFirst({
        where: { project_id: project.id },
        orderBy: { version: 'desc' },
        select: { body: true },
      }),
      this.db.client.productFact.findFirst({
        where: { project_id: project.id },
        orderBy: { version: 'desc' },
        select: { body: true },
      }),
    ]);
    return {
      timezone: project.timezone,
      min_call_duration_sec: project.min_call_duration_sec,
      card_key: card?.card_key ?? null,
      stages,
      scoring_prompt: prompt?.body ?? '',
      product_facts: facts?.body ?? '',
    };
  }

  async replace(account: AuthAccount, projectId: string, body: unknown): Promise<SettingsBody> {
    const project = await this.access.require(account, projectId, 'settings');
    const parsed = await parseSettings(body, this.db);
    if (!parsed.ok) {
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
              card_key: saved.card_key,
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

  async replacePrompt(account: AuthAccount, projectId: string, body: unknown): Promise<{ body: string }> {
    const project = await this.access.require(account, projectId, 'settings');
    const text = parseTextSetting(body);
    if (text === null) {
      throw new ApiError(422, { error: 'invalid_settings', details: ['scoring_prompt'] });
    }
    await this.appendVersion(project.id, 'scoring_prompts', text);
    return { body: text };
  }

  async replaceFacts(account: AuthAccount, projectId: string, body: unknown): Promise<{ body: string }> {
    const project = await this.access.require(account, projectId, 'settings');
    const text = parseTextSetting(body);
    if (text === null) {
      throw new ApiError(422, { error: 'invalid_settings', details: ['product_facts'] });
    }
    await this.appendVersion(project.id, 'product_facts', text);
    return { body: text };
  }

  private async appendVersion(projectId: string, table: 'scoring_prompts' | 'product_facts', body: string): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await this.db.client.$transaction(async (tx) => {
          const current = await tx.$queryRawUnsafe<Array<{ version: number }>>(
            `select version
             from ${table}
             where project_id = $1
             order by version desc
             limit 1
             for update`,
            projectId,
          );
          const version = (current[0]?.version ?? 0) + 1;
          if (table === 'scoring_prompts') {
            await tx.scoringPrompt.create({ data: { project_id: projectId, version, body } });
          } else {
            await tx.productFact.create({ data: { project_id: projectId, version, body } });
          }
        });
        return;
      } catch (error) {
        if (attempt === 0 && isUniqueViolation(error)) {
          continue;
        }
        throw error;
      }
    }
    throw new Error(`${table} version conflict`);
  }
}
