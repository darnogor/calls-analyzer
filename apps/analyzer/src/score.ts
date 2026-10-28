export type StageInput = {
  key: string;
  title: string;
  weight: number;
  high_score: string;
  defect_example: string;
  sample_line: string;
};

export type StageStatus = 'scored' | 'not_applicable' | 'unobservable';

export type StageResult = StageInput & {
  status: StageStatus;
  score: number | null;
  reason: string;
  evidence_ids: string[];
};

export type ViolationFlag = {
  code: string;
  evidence_ids: string[];
};

export type PaymentAgreement = {
  agreed: boolean | null;
  summary: string | null;
  evidence_ids: string[];
};

export type ModelScore = {
  stages: StageResult[];
  flags: ViolationFlag[];
  payment_agreement: PaymentAgreement;
};

const STATUSES = new Set<StageStatus>(['scored', 'not_applicable', 'unobservable']);

export function qualityScore(stages: Array<{ status: string; score: number | null; weight: number }>): number | null {
  let weighted = 0;
  let weights = 0;
  for (const stage of stages) {
    if (stage.status !== 'scored' || typeof stage.score !== 'number') {
      continue;
    }
    weighted += stage.weight * stage.score;
    weights += stage.weight;
  }
  if (weights === 0) {
    return null;
  }
  return Math.round((100 * weighted) / (4 * weights));
}

export function coverageRatio(stages: Array<{ status: string; weight: number }>): number | null {
  let scored = 0;
  let unobservable = 0;
  for (const stage of stages) {
    if (stage.status === 'scored') {
      scored += stage.weight;
    } else if (stage.status === 'unobservable') {
      unobservable += stage.weight;
    }
  }
  const denominator = scored + unobservable;
  if (denominator === 0) {
    return null;
  }
  return Math.round((scored / denominator) * 1_000_000) / 1_000_000;
}

export function isPreliminary(stages: Array<{ status: string }>): boolean {
  return stages.some((stage) => stage.status === 'unobservable');
}

export function parseModelJson(
  content: string,
  stages: StageInput[],
  transcriptIds: ReadonlySet<string>,
): { ok: true; value: ModelScore } | { ok: false } {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    return { ok: false };
  }
  if (!isRecord(value)) {
    return { ok: false };
  }
  const parsedStages = parseStages(value.stages, stages, transcriptIds);
  if (!parsedStages) {
    return { ok: false };
  }
  const flags = parseFlags(value.flags, transcriptIds);
  if (!flags) {
    return { ok: false };
  }
  const payment = parsePayment(value.payment_agreement, transcriptIds);
  if (!payment) {
    return { ok: false };
  }
  return { ok: true, value: { stages: parsedStages, flags, payment_agreement: payment } };
}

export function readStages(value: unknown): StageInput[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }
  const stages: StageInput[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!isRecord(item)) {
      return null;
    }
    const key = typeof item.key === 'string' ? item.key.trim() : '';
    const title = typeof item.title === 'string' ? item.title.trim() : '';
    const weight = typeof item.weight === 'number' ? item.weight : Number(item.weight);
    if (!key || !title || !Number.isFinite(weight)) {
      return null;
    }
    if (seen.has(key)) {
      return null;
    }
    seen.add(key);
    const high = text(item.high_score);
    const legacy = text(item.instruction);
    stages.push({
      key,
      title,
      weight,
      high_score: high || legacy,
      defect_example: text(item.defect_example),
      sample_line: text(item.sample_line),
    });
  }
  return stages;
}

function parseStages(
  value: unknown,
  expected: StageInput[],
  transcriptIds: ReadonlySet<string>,
): StageResult[] | null {
  if (!Array.isArray(value) || value.length !== expected.length) {
    return null;
  }
  const byKey = new Map<string, Record<string, unknown>>();
  for (const item of value) {
    if (!isRecord(item)) {
      return null;
    }
    const key = typeof item.key === 'string' ? item.key : typeof item.id === 'string' ? item.id : '';
    if (!key || byKey.has(key)) {
      return null;
    }
    byKey.set(key, item);
  }
  const scored: StageResult[] = [];
  for (const stage of expected) {
    const item = byKey.get(stage.key);
    if (!item) {
      return null;
    }
    const status = item.status;
    if (typeof status !== 'string' || !STATUSES.has(status as StageStatus)) {
      return null;
    }
    const stageStatus = status as StageStatus;
    const score = readScore(item.score, stageStatus);
    if (score === undefined) {
      return null;
    }
    const reason = typeof item.reason === 'string' ? item.reason.trim() : '';
    if (!reason) {
      return null;
    }
    const evidence = readEvidence(item.evidence_ids, transcriptIds, false);
    if (!evidence) {
      return null;
    }
    scored.push({
      ...stage,
      status: stageStatus,
      score,
      reason,
      evidence_ids: evidence,
    });
  }
  return scored;
}

function readScore(value: unknown, status: StageStatus): number | null | undefined {
  if (status === 'scored') {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 4) {
      return undefined;
    }
    return value;
  }
  if (value === null || value === undefined) {
    return null;
  }
  return undefined;
}

function parseFlags(value: unknown, transcriptIds: ReadonlySet<string>): ViolationFlag[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const flags: ViolationFlag[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      return null;
    }
    const code = typeof item.code === 'string' ? item.code.trim() : '';
    if (!code || code.length > 80) {
      return null;
    }
    const evidence = readEvidence(item.evidence_ids, transcriptIds, true);
    if (!evidence) {
      return null;
    }
    flags.push({ code, evidence_ids: evidence });
  }
  return flags;
}

function parsePayment(value: unknown, transcriptIds: ReadonlySet<string>): PaymentAgreement | null {
  if (!isRecord(value)) {
    return null;
  }
  const agreed = value.agreed;
  if (agreed !== true && agreed !== false && agreed !== null) {
    return null;
  }
  let summary: string | null = null;
  if (value.summary !== null && value.summary !== undefined) {
    if (typeof value.summary !== 'string') {
      return null;
    }
    summary = value.summary.trim() || null;
  }
  const evidence = readEvidence(value.evidence_ids, transcriptIds, agreed === true);
  if (!evidence) {
    return null;
  }
  return { agreed, summary, evidence_ids: evidence };
}

function readEvidence(value: unknown, transcriptIds: ReadonlySet<string>, required: boolean): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || item.trim() === '' || !transcriptIds.has(item)) {
      return null;
    }
    if (!ids.includes(item)) {
      ids.push(item);
    }
  }
  if (required && ids.length === 0) {
    return null;
  }
  return ids;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
