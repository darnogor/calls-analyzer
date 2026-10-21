import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PluginSource } from '../auth/source-tokens';
import { SourceTokens } from '../auth/source-tokens';
import { Database } from '../db/database';
import { ApiError } from '../errors';
import {
  CONTACT_PATCH_SQL,
  DEAL_PATCH_SQL,
  MANAGER_DEACTIVATE_SQL,
  MANAGER_UPSERT_SQL,
  parseContactPatch,
  parseDealPatch,
  parseManagerDirectory,
} from './parse';

@Injectable()
export class DirectoryService {
  constructor(
    private readonly db: Database,
    private readonly tokens: SourceTokens,
  ) {}

  async syncManagers(
    source: PluginSource,
    projectId: string,
    body: unknown,
  ): Promise<{ upserted: number }> {
    const project = await this.tokens.requireProject(source, projectId);
    const parsed = parseManagerDirectory(body);
    if (!parsed) {
      throw new ApiError(422, { error: 'invalid_payload' });
    }
    await this.db.tx(async (client) => {
      for (const item of parsed.items) {
        await client.query(MANAGER_UPSERT_SQL, [
          randomUUID(),
          project.id,
          source.id,
          item.external_id,
          item.name,
          item.email,
          item.is_active,
          item.emailProvided,
        ]);
      }
      await client.query(MANAGER_DEACTIVATE_SQL, [
        project.id,
        source.id,
        parsed.items.map((item) => item.external_id),
      ]);
      await client.query('update sources set last_intake_at = now() where id = $1', [source.id]);
    });
    return { upserted: parsed.items.length };
  }

  async patchContact(
    source: PluginSource,
    projectId: string,
    externalId: string,
    body: unknown,
  ): Promise<{ name: string; company_name: string | null; external_url: string | null }> {
    const project = await this.tokens.requireProject(source, projectId);
    const patch = parseContactPatch(body);
    if (!patch) {
      throw new ApiError(422, { error: 'invalid_payload' });
    }
    const key = externalId.trim();
    if (!key) {
      throw new ApiError(404, { error: 'contact_not_found' });
    }
    const setsName = patch.name !== undefined;
    const setsCompany = patch.company_name !== undefined;
    const setsUrl = patch.external_url !== undefined;
    const result = await this.db.query<{
      name: string;
      company_name: string | null;
      external_url: string | null;
    }>(
      setsName || setsCompany || setsUrl
        ? CONTACT_PATCH_SQL
        : `select name, company_name, external_url
           from contacts
           where project_id = $1 and source_id = $2 and external_id = $3`,
      setsName || setsCompany || setsUrl
        ? [
            project.id,
            source.id,
            key,
            setsName,
            patch.name ?? null,
            setsCompany,
            patch.company_name ?? null,
            setsUrl,
            patch.external_url ?? null,
          ]
        : [project.id, source.id, key],
    );
    const row = result.rows[0];
    if (!row) {
      throw new ApiError(404, { error: 'contact_not_found' });
    }
    return {
      name: row.name,
      company_name: row.company_name,
      external_url: row.external_url,
    };
  }

  async patchDeal(
    source: PluginSource,
    projectId: string,
    externalId: string,
    body: unknown,
  ): Promise<{ updated: number }> {
    const project = await this.tokens.requireProject(source, projectId);
    const patch = parseDealPatch(body);
    if (!patch) {
      throw new ApiError(422, { error: 'invalid_payload' });
    }
    const key = externalId.trim();
    if (!key) {
      throw new ApiError(404, { error: 'deal_not_found' });
    }
    const setsStatus = patch.current_status_name !== undefined;
    const setsUrl = patch.external_url !== undefined;
    return this.db.tx(async (client) => {
      const found = await client.query<{ updated: number }>(
        `select count(*)::int as updated
         from calls
         where project_id = $1 and source_id = $2 and deal_external_id = $3`,
        [project.id, source.id, key],
      );
      const updated = found.rows[0]?.updated ?? 0;
      if (!updated) {
        throw new ApiError(404, { error: 'deal_not_found' });
      }
      if (setsStatus || setsUrl) {
        await client.query(DEAL_PATCH_SQL, [
          project.id,
          source.id,
          key,
          setsStatus,
          patch.current_status_name ?? null,
          setsUrl,
          patch.external_url ?? null,
        ]);
      }
      return { updated };
    });
  }
}
