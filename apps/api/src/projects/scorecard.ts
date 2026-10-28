import type { PrismaClient } from '@calls/db';

export type Stage = {
  key: string;
  title: string;
  weight: number;
  high_score: string;
  defect_example: string;
  sample_line: string;
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
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue;
    }
    const record = item as Record<string, unknown>;
    if (typeof record.key !== 'string' || record.key === '' || seen.has(record.key)) {
      continue;
    }
    seen.add(record.key);
    const title = typeof record.title === 'string' ? record.title.trim() : '';
    const high = text(record.high_score);
    const legacy = text(record.instruction);
    stages.push({
      key: record.key,
      title: title || record.key,
      weight: typeof record.weight === 'number' && Number.isFinite(record.weight) ? record.weight : 0,
      high_score: high || legacy,
      defect_example: text(record.defect_example),
      sample_line: text(record.sample_line),
    });
  }
  return stages;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
