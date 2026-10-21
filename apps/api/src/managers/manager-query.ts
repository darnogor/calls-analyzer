import { parseCalendarDay } from '../calls/list-query';
import { ApiError } from '../errors';

export type ManagerSort =
  | { kind: 'name' }
  | { kind: 'calls_count' }
  | { kind: 'overall' }
  | { kind: 'stage'; key: string };

export type ParsedManagerQuery = {
  dateFrom?: string;
  dateTo?: string;
  sort: ManagerSort;
  order: 'asc' | 'desc';
};

export function parseManagerQuery(query: Record<string, unknown>, stageKeys: readonly string[]): ParsedManagerQuery {
  const dateFrom = parseCalendarDay(query.date_from);
  const dateTo = parseCalendarDay(query.date_to);
  const orderRaw = firstString(query.order) ?? 'desc';
  if (orderRaw !== 'asc' && orderRaw !== 'desc') {
    throw new ApiError(400, { error: 'invalid_query' });
  }
  const sortRaw = firstString(query.sort) ?? 'overall';
  let sort: ManagerSort;
  if (sortRaw === 'name') {
    sort = { kind: 'name' };
  } else if (sortRaw === 'calls_count') {
    sort = { kind: 'calls_count' };
  } else if (sortRaw === 'overall') {
    sort = { kind: 'overall' };
  } else if (sortRaw.startsWith('stage.')) {
    const key = sortRaw.slice('stage.'.length);
    if (!stageKeys.includes(key)) {
      throw new ApiError(400, { error: 'invalid_query' });
    }
    sort = { kind: 'stage', key };
  } else {
    throw new ApiError(400, { error: 'invalid_query' });
  }
  const parsed: ParsedManagerQuery = { sort, order: orderRaw };
  if (dateFrom !== undefined) {
    parsed.dateFrom = dateFrom;
  }
  if (dateTo !== undefined) {
    parsed.dateTo = dateTo;
  }
  return parsed;
}

export function parseManagerName(body: unknown): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return null;
  }
  const name = (body as { name?: unknown }).name;
  if (typeof name !== 'string') {
    return null;
  }
  const trimmed = name.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed;
}

function firstString(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return firstString(value[0]);
  }
  return typeof value === 'string' ? value : undefined;
}
