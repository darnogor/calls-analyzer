import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PluginSource } from '../auth/source-tokens';
import { SourceTokens } from '../auth/source-tokens';
import { Database } from '../db/database';
import { ApiError } from '../errors';
import {
  CONTACT_PATCH_SQL,
  DEAL_PATCH_SQL,
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
    await this.db.client.$transaction(async (tx) => {
      for (const item of parsed.items) {
        await tx.$executeRawUnsafe(
          MANAGER_UPSERT_SQL,
          randomUUID(),
          project.id,
          source.id,
          item.external_id,
          item.name,
          item.email,
          item.is_active,
          item.emailProvided,
        );
      }
      const keep = parsed.items.map((item) => item.external_id);
      await tx.manager.updateMany({
        where: {
          project_id: project.id,
          source_id: source.id,
          is_active: true,
          AND: [
            { external_id: { not: null } },
            { NOT: { external_id: '' } },
            ...(keep.length > 0 ? [{ NOT: { external_id: { in: keep } } }] : []),
          ],
        },
        data: { is_active: false, updated_at: new Date() },
      });
      await tx.source.update({
        where: { id: source.id },
        data: { last_intake_at: new Date() },
      });
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
    const where = { project_id: project.id, source_id: source.id, external_id: key };
    let row: { name: string; company_name: string | null; external_url: string | null } | undefined;
    if (setsName || setsCompany || setsUrl) {
      const updated = await this.db.client.$queryRawUnsafe<
        Array<{ name: string; company_name: string | null; external_url: string | null }>
      >(
        CONTACT_PATCH_SQL,
        project.id,
        source.id,
        key,
        setsName,
        patch.name ?? null,
        setsCompany,
        patch.company_name ?? null,
        setsUrl,
        patch.external_url ?? null,
      );
      row = updated[0];
    } else {
      row =
        (await this.db.client.contact.findFirst({
          where,
          select: { name: true, company_name: true, external_url: true },
        })) ?? undefined;
    }
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
    return this.db.client.$transaction(async (tx) => {
      const updated = await tx.call.count({
        where: { project_id: project.id, source_id: source.id, deal_external_id: key },
      });
      if (!updated) {
        throw new ApiError(404, { error: 'deal_not_found' });
      }
      if (setsStatus || setsUrl) {
        await tx.$executeRawUnsafe(
          DEAL_PATCH_SQL,
          project.id,
          source.id,
          key,
          setsStatus,
          patch.current_status_name ?? null,
          setsUrl,
          patch.external_url ?? null,
        );
      }
      return { updated };
    });
  }
}
