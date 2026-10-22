import { STAGE_KEYS, type Stage } from './scorecard';

export type SettingsBody = {
  timezone: string;
  min_call_duration_sec: number;
  stages: Stage[];
};

export type SettingsParse =
  | { ok: true; value: SettingsBody }
  | { ok: false; error: 'stage_set_is_fixed' }
  | { ok: false; error: 'invalid_settings'; details: string[] };

const WEIGHT_EPSILON = 1e-6;

export type TimeZoneDirectory = {
  query(text: string, params?: unknown[]): Promise<{ rows: Array<{ name: string }> }>;
};

export async function pgTimeZoneName(timeZones: TimeZoneDirectory, timezone: string): Promise<string | null> {
  const result = await timeZones.query(
    `select name
     from pg_timezone_names
     where lower(name) = lower($1)
     order by name = $1 desc
     limit 1`,
    [timezone],
  );
  const name = result.rows[0]?.name;
  return typeof name === 'string' && name.length > 0 ? name : null;
}

export async function parseSettings(body: unknown, timeZones: TimeZoneDirectory): Promise<SettingsParse> {
  if (!isRecord(body)) {
    return { ok: false, error: 'invalid_settings', details: ['timezone', 'min_call_duration_sec', 'stages'] };
  }
  if (!isFixedStageSet(body.stages)) {
    return { ok: false, error: 'stage_set_is_fixed' };
  }
  const details: string[] = [];
  const requested = typeof body.timezone === 'string' ? body.timezone.trim() : '';
  const timezone = requested ? await pgTimeZoneName(timeZones, requested) : null;
  if (!timezone) {
    details.push('timezone');
  }
  if (!isPositiveInt(body.min_call_duration_sec)) {
    details.push('min_call_duration_sec');
  }
  const byKey = new Map<string, Record<string, unknown>>();
  for (const stage of body.stages as unknown[]) {
    const record = stage as Record<string, unknown>;
    byKey.set(String(record.key), record);
  }
  const stages: Stage[] = [];
  let weightsOk = true;
  for (const key of STAGE_KEYS) {
    const record = byKey.get(key)!;
    const title = typeof record.title === 'string' ? record.title.trim() : '';
    if (!title) {
      details.push('stage_title');
    }
    if (typeof record.weight !== 'number' || !Number.isFinite(record.weight) || record.weight < -WEIGHT_EPSILON || record.weight > 1 + WEIGHT_EPSILON) {
      weightsOk = false;
      details.push('stage_weight');
    }
    if (typeof record.instruction !== 'string') {
      details.push('stage_instruction');
    }
    stages.push({
      key,
      title,
      weight: typeof record.weight === 'number' ? record.weight : 0,
      instruction: typeof record.instruction === 'string' ? record.instruction : '',
    });
  }
  if (weightsOk && !weightsSumToOne(stages.map((stage) => stage.weight))) {
    details.push('weights_sum_must_be_1');
  }
  const unique = [...new Set(details)];
  if (unique.length > 0) {
    return { ok: false, error: 'invalid_settings', details: unique };
  }
  return {
    ok: true,
    value: {
      timezone: timezone ?? '',
      min_call_duration_sec: body.min_call_duration_sec as number,
      stages,
    },
  };
}

function isFixedStageSet(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== STAGE_KEYS.length) {
    return false;
  }
  const keys: string[] = [];
  for (const stage of value) {
    if (!isRecord(stage) || typeof stage.key !== 'string') {
      return false;
    }
    keys.push(stage.key);
  }
  if (new Set(keys).size !== STAGE_KEYS.length) {
    return false;
  }
  return STAGE_KEYS.every((key) => keys.includes(key));
}

function weightsSumToOne(weights: number[]): boolean {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return Math.abs(total - 1) <= WEIGHT_EPSILON;
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
