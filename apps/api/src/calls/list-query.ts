import { ApiError } from '../errors';
import { isUuid } from '../ids';

export type ParsedListQuery = {
  view: 'completed' | 'problems' | 'progress';
  managerId?: string;
  dateFrom?: string;
  dateTo?: string;
  q?: string;
  dealStatus?: string;
  field?: { key: string; value: string };
  sort: 'started_at' | 'manager' | 'overall' | 'stage';
  stageKey?: string;
  order: 'asc' | 'desc';
  page: number;
  perPage: number;
};

export function requestedAction(query: Record<string, unknown>): 'read' | 'problems' {
  const view = firstString(query.view);
  if (view === 'problems' || view === 'progress') {
    return 'problems';
  }
  return 'read';
}

export function parseListQuery(query: Record<string, unknown>, stageKeys: readonly string[]): ParsedListQuery {
  const viewRaw = firstString(query.view);
  let view: ParsedListQuery['view'] = 'completed';
  if (viewRaw !== undefined && viewRaw !== '') {
    if (viewRaw !== 'problems' && viewRaw !== 'progress') {
      throw new ApiError(400, { error: 'invalid_query' });
    }
    view = viewRaw;
  }

  const managerRaw = firstString(query.manager_id);
  let managerId: string | undefined;
  if (managerRaw !== undefined && managerRaw !== '') {
    if (!isUuid(managerRaw)) {
      throw new ApiError(400, { error: 'invalid_query' });
    }
    managerId = managerRaw;
  }

  const dateFrom = parseDay(query.date_from);
  const dateTo = parseDay(query.date_to);
  const qRaw = firstString(query.q);
  const q = qRaw && qRaw !== '' ? qRaw : undefined;
  const dealRaw = firstString(query.deal_status);
  const dealStatus = dealRaw && dealRaw !== '' ? dealRaw : undefined;

  const hasFieldKey = query.field_key !== undefined;
  const hasFieldValue = query.field_value !== undefined;
  if (hasFieldKey !== hasFieldValue) {
    throw new ApiError(400, { error: 'invalid_query' });
  }
  let field: { key: string; value: string } | undefined;
  if (hasFieldKey && hasFieldValue) {
    const key = firstString(query.field_key);
    const value = firstString(query.field_value);
    if (key === undefined || value === undefined) {
      throw new ApiError(400, { error: 'invalid_query' });
    }
    field = { key, value };
  }

  const sortRaw = firstString(query.sort) ?? 'started_at';
  const orderRaw = firstString(query.order) ?? 'desc';
  if (orderRaw !== 'asc' && orderRaw !== 'desc') {
    throw new ApiError(400, { error: 'invalid_query' });
  }
  let sort: ParsedListQuery['sort'];
  let stageKey: string | undefined;
  if (sortRaw === 'started_at' || sortRaw === 'manager' || sortRaw === 'overall') {
    sort = sortRaw;
  } else if (sortRaw.startsWith('stage.')) {
    stageKey = sortRaw.slice('stage.'.length);
    if (!stageKeys.includes(stageKey)) {
      throw new ApiError(400, { error: 'invalid_query' });
    }
    sort = 'stage';
  } else {
    throw new ApiError(400, { error: 'invalid_query' });
  }

  const page = parsePositiveInt(query.page, 1);
  const perPage = parsePositiveInt(query.per_page, 50);
  if (perPage > 100) {
    throw new ApiError(400, { error: 'invalid_query' });
  }

  const parsed: ParsedListQuery = { view, sort, order: orderRaw, page, perPage };
  if (managerId !== undefined) parsed.managerId = managerId;
  if (dateFrom !== undefined) parsed.dateFrom = dateFrom;
  if (dateTo !== undefined) parsed.dateTo = dateTo;
  if (q !== undefined) parsed.q = q;
  if (dealStatus !== undefined) parsed.dealStatus = dealStatus;
  if (field !== undefined) parsed.field = field;
  if (stageKey !== undefined) parsed.stageKey = stageKey;
  return parsed;
}

function parseDay(value: unknown): string | undefined {
  const raw = firstString(value);
  if (raw === undefined || raw === '') {
    return undefined;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new ApiError(400, { error: 'invalid_query' });
  }
  const [year, month, day] = raw.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month! - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new ApiError(400, { error: 'invalid_query' });
  }
  return raw;
}

function parsePositiveInt(value: unknown, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  const raw = firstString(value);
  if (raw === undefined || !/^\d+$/.test(raw)) {
    throw new ApiError(400, { error: 'invalid_query' });
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new ApiError(400, { error: 'invalid_query' });
  }
  return parsed;
}

function firstString(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return firstString(value[0]);
  }
  return typeof value === 'string' ? value : undefined;
}
