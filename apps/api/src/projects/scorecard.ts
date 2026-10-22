import type { PrismaClient } from '@calls/db';

export const STAGE_KEYS = ['opening', 'needs', 'presentation', 'objections', 'closing'] as const;

export type Stage = {
  key: string;
  title: string;
  weight: number;
  instruction: string;
};

export async function loadCurrentStages(db: PrismaClient, projectId: string): Promise<Stage[]> {
  const row = await db.scorecard.findFirst({
    where: { project_id: projectId },
    orderBy: { version: 'desc' },
    select: { stages_json: true },
  });
  return readStages(row?.stages_json);
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
