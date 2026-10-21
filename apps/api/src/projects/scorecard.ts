import type { Queryable } from '../db/database';

export const STAGE_KEYS = ['opening', 'needs', 'presentation', 'objections', 'closing'] as const;

export type Stage = {
  key: string;
  title: string;
  weight: number;
  instruction: string;
};

export async function loadCurrentStages(db: Queryable, projectId: string): Promise<Stage[]> {
  const result = await db.query<{ stages_json: unknown }>(
    `select stages_json
     from scorecards
     where project_id = $1
     order by version desc
     limit 1`,
    [projectId],
  );
  return readStages(result.rows[0]?.stages_json);
}

export function readStages(value: unknown): Stage[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const stages: Stage[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue;
    }
    const record = item as Record<string, unknown>;
    if (typeof record.key !== 'string' || record.key === '') {
      continue;
    }
    const title = typeof record.title === 'string' ? record.title.trim() : '';
    stages.push({
      key: record.key,
      title: title || record.key,
      weight: typeof record.weight === 'number' && Number.isFinite(record.weight) ? record.weight : 0,
      instruction: typeof record.instruction === 'string' ? record.instruction : '',
    });
  }
  return stages;
}
