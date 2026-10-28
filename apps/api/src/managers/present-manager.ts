import type { ManagerSort } from './manager-query';
import type { Stage } from '../projects/scorecard';
import { iso } from '../time';

export type ManagerCallRow = {
  id: string;
  name: string;
  email: string | null;
  is_active: boolean;
  source_kind: string;
  source_provider: string | null;
  started_at: Date | string | null;
  overall_score: number | string | null;
  stages_json: unknown;
};

export type ManagerItem = {
  id: string;
  name: string;
  email?: string | null;
  is_active: boolean;
  source: { kind: string; provider: string | null };
  calls_count: number;
  stages: { key: string; title: string; score: number | null }[];
  overall_score: number | null;
  last_call_at: string | null;
};

export function roundAverage(values: Array<number | null | undefined>): number | null {
  const nums = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (nums.length === 0) {
    return null;
  }
  return Math.round(nums.reduce((sum, value) => sum + value, 0) / nums.length);
}

export function stageScore(stages: unknown, key: string): number | null {
  if (!Array.isArray(stages)) {
    return null;
  }
  for (const item of stages) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue;
    }
    const record = item as Record<string, unknown>;
    if (record.key !== key) {
      continue;
    }
    if (record.status === 'not_applicable' || record.status === 'unobservable') {
      return null;
    }
    return asNumber(record.score);
  }
  return null;
}

export function aggregateManagers(
  rows: ManagerCallRow[],
  stages: Stage[],
  options: { includeEmail: boolean; dropInactiveWithoutCalls: boolean },
): ManagerItem[] {
  const order: string[] = [];
  const buckets = new Map<string, ManagerCallRow & { calls: ManagerCallRow[] }>();
  for (const row of rows) {
    let bucket = buckets.get(row.id);
    if (!bucket) {
      bucket = { ...row, calls: [] };
      buckets.set(row.id, bucket);
      order.push(row.id);
    }
    if (row.started_at != null) {
      bucket.calls.push(row);
    }
  }
  const items: ManagerItem[] = [];
  for (const id of order) {
    const bucket = buckets.get(id)!;
    if (options.dropInactiveWithoutCalls && !bucket.is_active && bucket.calls.length === 0) {
      continue;
    }
    items.push(presentBucket(bucket, bucket.calls, stages, options.includeEmail));
  }
  return items;
}

export function sortManagers(items: ManagerItem[], sort: ManagerSort, order: 'asc' | 'desc'): ManagerItem[] {
  const direction = order === 'asc' ? 1 : -1;
  return [...items].sort((left, right) => {
    const primary = comparePrimary(left, right, sort, direction);
    if (primary !== 0) {
      return primary;
    }
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
}

function presentBucket(
  row: ManagerCallRow,
  calls: ManagerCallRow[],
  stages: Stage[],
  includeEmail: boolean,
): ManagerItem {
  let last: Date | null = null;
  for (const call of calls) {
    const at = call.started_at instanceof Date ? call.started_at : new Date(String(call.started_at));
    if (Number.isNaN(at.getTime())) {
      continue;
    }
    if (!last || at > last) {
      last = at;
    }
  }
  const item: ManagerItem = {
    id: row.id,
    name: row.name,
    is_active: row.is_active,
    source: { kind: row.source_kind, provider: row.source_provider },
    calls_count: calls.length,
    stages: stages.map((stage) => ({
      key: stage.key,
      title: stage.title,
      score: roundAverage(calls.map((call) => stageScore(call.stages_json, stage.key))),
    })),
    overall_score: roundAverage(calls.map((call) => asNumber(call.overall_score))),
    last_call_at: iso(last),
  };
  if (includeEmail) {
    item.email = row.email;
  }
  return item;
}

function comparePrimary(left: ManagerItem, right: ManagerItem, sort: ManagerSort, direction: number): number {
  if (sort.kind === 'name') {
    return left.name.localeCompare(right.name, 'ru') * direction;
  }
  if (sort.kind === 'calls_count') {
    return (left.calls_count - right.calls_count) * direction;
  }
  return compareScore(scoreOf(left, sort), scoreOf(right, sort), direction);
}

function compareScore(left: number | null, right: number | null, direction: number): number {
  if (left == null && right == null) {
    return 0;
  }
  if (left == null) {
    return 1;
  }
  if (right == null) {
    return -1;
  }
  return (left - right) * direction;
}

function scoreOf(item: ManagerItem, sort: ManagerSort): number | null {
  if (sort.kind === 'overall') {
    return item.overall_score;
  }
  if (sort.kind === 'stage') {
    return item.stages.find((stage) => stage.key === sort.key)?.score ?? null;
  }
  return null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}
