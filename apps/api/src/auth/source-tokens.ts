import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { ProjectRecord } from '../access';
import { Database } from '../db/database';
import { ApiError } from '../errors';
import { isUuid } from '../ids';
import { secretHash } from '../sources/secrets';
import { bearerToken } from './bearer';

export type PluginSource = {
  id: string;
  project_id: string;
};

@Injectable()
export class SourceTokens {
  constructor(private readonly db: Database) {}

  async authenticate(header: string | string[] | undefined): Promise<PluginSource> {
    const token = bearerToken(header);
    if (!token) {
      throw new ApiError(401, { error: 'unauthenticated' });
    }
    const result = await this.db.query<PluginSource>(
      `select id, project_id from sources where token_hash = $1`,
      [secretHash(token)],
    );
    const source = result.rows[0];
    if (!source) {
      throw new ApiError(401, { error: 'unauthenticated' });
    }
    return source;
  }

  async requireProject(source: PluginSource, projectId: string): Promise<ProjectRecord> {
    if (!isUuid(projectId)) {
      throw new ApiError(404, { error: 'project_not_found' });
    }
    const result = await this.db.query<ProjectRecord>(
      `select id, name, timezone, min_call_duration_sec from projects where id = $1`,
      [projectId],
    );
    const project = result.rows[0];
    if (!project) {
      throw new ApiError(404, { error: 'project_not_found' });
    }
    if (source.project_id !== project.id) {
      throw new ApiError(403, { error: 'source_project_mismatch' });
    }
    return project;
  }
}

export function sourceFrom(req: Request): PluginSource {
  const source = (req as Request & { source?: PluginSource }).source;
  if (!source) {
    throw new ApiError(401, { error: 'unauthenticated' });
  }
  return source;
}
