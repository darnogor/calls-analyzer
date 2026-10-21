export type StageInput = {
  key: string;
  title: string;
  weight: number;
  instruction: string;
};

export type StageScore = StageInput & {
  score: number;
  comment: string;
};

export function overallScore(stages: Array<{ score: number; weight: number }>): number {
  const total = stages.reduce((sum, stage) => sum + stage.score * stage.weight, 0);
  return Math.round(total);
}

export function parseModelJson(
  content: string,
  stages: StageInput[],
): { ok: true; stages: StageScore[]; summary: string } | { ok: false } {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    return { ok: false };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false };
  }
  const record = value as { stages?: unknown; summary?: unknown };
  if (typeof record.summary !== 'string' || record.summary.trim() === '') {
    return { ok: false };
  }
  if (!record.stages || typeof record.stages !== 'object' || Array.isArray(record.stages)) {
    return { ok: false };
  }
  const stageRecord = record.stages as Record<string, unknown>;
  const expected = stages.map((stage) => stage.key);
  const actual = Object.keys(stageRecord);
  if (actual.length !== expected.length || expected.some((key) => !Object.prototype.hasOwnProperty.call(stageRecord, key))) {
    return { ok: false };
  }
  const scored: StageScore[] = [];
  for (const stage of stages) {
    const item = stageRecord[stage.key];
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { ok: false };
    }
    const score = (item as { score?: unknown }).score;
    const comment = (item as { comment?: unknown }).comment;
    if (typeof score !== 'number' || !Number.isInteger(score) || score < 0 || score > 100) {
      return { ok: false };
    }
    if (typeof comment !== 'string' || comment.trim() === '') {
      return { ok: false };
    }
    scored.push({
      key: stage.key,
      title: stage.title,
      weight: stage.weight,
      instruction: stage.instruction,
      score,
      comment: comment.trim(),
    });
  }
  return { ok: true, stages: scored, summary: record.summary.trim() };
}

export function readStages(value: unknown): StageInput[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const stages: StageInput[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return null;
    }
    const record = item as { key?: unknown; title?: unknown; weight?: unknown; instruction?: unknown };
    const key = typeof record.key === 'string' ? record.key.trim() : '';
    const title = typeof record.title === 'string' ? record.title : '';
    const instruction = typeof record.instruction === 'string' ? record.instruction : '';
    const weight = typeof record.weight === 'number' ? record.weight : Number(record.weight);
    if (!key || !title || !Number.isFinite(weight)) {
      return null;
    }
    stages.push({ key, title, weight, instruction });
  }
  return stages;
}
