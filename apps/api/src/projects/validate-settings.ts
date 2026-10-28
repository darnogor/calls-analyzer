import type { Stage } from './scorecard';

export type SettingsBody = {
  timezone: string;
  min_call_duration_sec: number;
  stages: Stage[];
};

export type SettingsParse =
  | { ok: true; value: SettingsBody }
  | { ok: false; error: 'invalid_settings'; details: string[] };

export type TimeZoneDirectory = {
  query(text: string, params?: unknown[]): Promise<{ rows: Array<{ name: string }> }>;
};

const KEY_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

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
  const details: string[] = [];
  const requested = typeof body.timezone === 'string' ? body.timezone.trim() : '';
  const timezone = requested ? await pgTimeZoneName(timeZones, requested) : null;
  if (!timezone) {
    details.push('timezone');
  }
  if (!isPositiveInt(body.min_call_duration_sec)) {
    details.push('min_call_duration_sec');
  }
  const stages = parseStages(body.stages, details);
  const unique = [...new Set(details)];
  if (unique.length > 0 || !stages) {
    return { ok: false, error: 'invalid_settings', details: unique.length > 0 ? unique : ['stages'] };
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

export function parseTextSetting(body: unknown): string | null {
  if (!isRecord(body) || typeof body.body !== 'string') {
    return null;
  }
  return body.body;
}

function parseStages(value: unknown, details: string[]): Stage[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    details.push('stages');
    return null;
  }
  const stages: Stage[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!isRecord(item)) {
      details.push('stages');
      return null;
    }
    const key = typeof item.key === 'string' ? item.key.trim() : '';
    if (!KEY_PATTERN.test(key) || seen.has(key)) {
      details.push('stage_key');
    } else {
      seen.add(key);
    }
    const title = typeof item.title === 'string' ? item.title.trim() : '';
    if (!title) {
      details.push('stage_title');
    }
    if (typeof item.weight !== 'number' || !Number.isFinite(item.weight) || item.weight <= 0) {
      details.push('stage_weight');
    }
    if (typeof item.high_score !== 'string') {
      details.push('stage_high_score');
    }
    if (typeof item.defect_example !== 'string') {
      details.push('stage_defect_example');
    }
    if (typeof item.sample_line !== 'string') {
      details.push('stage_sample_line');
    }
    stages.push({
      key,
      title,
      weight: typeof item.weight === 'number' ? item.weight : 0,
      high_score: typeof item.high_score === 'string' ? item.high_score : '',
      defect_example: typeof item.defect_example === 'string' ? item.defect_example : '',
      sample_line: typeof item.sample_line === 'string' ? item.sample_line : '',
    });
  }
  if (details.length > 0) {
    return null;
  }
  return stages;
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
