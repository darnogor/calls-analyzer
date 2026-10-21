export const EMPTY_DEAL_STAGE = 'Все стадии';
export const ALL_MANAGERS = 'Все менеджеры';

export const STAGE_ORDER = ['opening', 'needs', 'presentation', 'objections', 'closing'];

export const DEFAULT_STAGE_TITLES = {
  opening: 'Открытие',
  needs: 'Потребность',
  presentation: 'Презентация',
  objections: 'Возражения',
  closing: 'Закрытие',
};

const CALL_ERRORS = {
  empty_transcript: 'Пустой ответ распознавания',
  transcript_missing: 'Нет транскрипта',
  invalid_model_json: 'Ответ модели не разобран',
  provider_unavailable: 'Провайдер распознавания недоступен',
  model_unavailable: 'Модель недоступна',
  audio_network_failure: 'Не удалось скачать запись',
  audio_object_missing: 'Файла нет в хранилище',
};

const STATUS_LABELS = {
  recording_pending: 'Ожидает запись',
  recording_missing: 'Записи не будет',
  audio_queued: 'В очереди на скачивание',
  audio_fetch: 'Скачивание записи',
  skipped_short: 'Короче порога',
  skipped_no_duration: 'Длительность не прочитана',
  transcribing: 'Распознавание',
  analyzing: 'Оценка',
  completed: 'Готово',
  failed: 'Ошибка',
};

const PROGRESS_STATUSES = new Set([
  'recording_pending',
  'audio_queued',
  'audio_fetch',
  'transcribing',
  'analyzing',
]);

const PER_PAGE = new Set([20, 50, 100]);

export function scoreBand(score) {
  if (score === null || score === undefined || score === '') return null;
  const value = Number(score);
  if (!Number.isFinite(value)) return null;
  if (value >= 80) return 'green';
  if (value >= 60) return 'yellow';
  return 'red';
}

export function formatScore(score) {
  if (score === null || score === undefined || score === '') return null;
  const value = Number(score);
  if (!Number.isFinite(value)) return null;
  if (Number.isInteger(value)) return String(value);
  return String(Math.round(value * 10) / 10);
}

export function formatWeight(weight) {
  const value = Number(weight);
  if (!Number.isFinite(value)) return '';
  const percent = Math.round(value * 1000) / 10;
  return `${Number.isInteger(percent) ? percent : percent}%`;
}

export function percentSumIs100(percents) {
  const sum = percents.reduce((total, value) => total + Math.round(Number(value) * 10), 0);
  return sum === 1000;
}

export function percentsToWeights(percents) {
  const weights = percents.map((value) => Number((Number(value) / 100).toFixed(4)));
  if (!percentSumIs100(percents)) return weights;
  const units = weights.map((value) => Math.round(value * 10000));
  const drift = 10000 - units.reduce((total, value) => total + value, 0);
  units[units.length - 1] += drift;
  return units.map((value) => value / 10000);
}

export function translateCallError(code) {
  if (typeof code !== 'string' || code === '') return null;
  if (!Object.hasOwn(CALL_ERRORS, code)) return 'Ошибка обработки';
  return CALL_ERRORS[code];
}

export function translateStatus(status) {
  return STATUS_LABELS[status] ?? 'Неизвестный статус';
}

export function isProgressStatus(status) {
  return PROGRESS_STATUSES.has(status);
}

export function linkStatusText(status) {
  if (status === 'ambiguous') return 'Несколько активных сделок';
  if (status === 'unresolved') return 'Сделка не определена';
  return '';
}

export function dealCurrentStage(deal) {
  if (!deal) return '';
  if (typeof deal.status_name === 'string' && deal.status_name.trim()) return deal.status_name.trim();
  return linkStatusText(deal.link_status);
}

export function dealAtCallStage(deal) {
  if (!deal) return '';
  if (typeof deal.status_at_call_name === 'string' && deal.status_at_call_name.trim()) {
    return deal.status_at_call_name.trim();
  }
  return linkStatusText(deal.link_status);
}

export function dealTitle(deal) {
  if (!deal) return '';
  if (typeof deal.name === 'string' && deal.name.trim()) return deal.name.trim();
  return linkStatusText(deal.link_status);
}

export function translateRequestError(body, status) {
  const code = body && typeof body.error === 'string' ? body.error : '';
  if (code === 'unauthenticated' || status === 401) return 'Нужно войти снова';
  if (code === 'forbidden' || status === 403) return 'Недостаточно прав';
  if (code === 'project_not_found') return 'Проект не найден';
  if (code === 'call_not_found') return 'Звонок не найден';
  if (code === 'manager_not_found') return 'Менеджер не найден';
  if (code === 'invalid_query') return 'Некорректные параметры списка';
  if (code === 'invalid_payload') return 'Проверьте заполнение полей';
  if (code === 'duration_below_minimum') {
    const min = body?.min_call_duration_sec;
    const got = body?.duration_sec;
    if (typeof min === 'number' && typeof got === 'number') {
      return `Длительность ${got} с ниже порога ${min} с`;
    }
    return 'Длительность ниже порога проекта';
  }
  if (code === 'email_taken') return 'Такая почта уже есть';
  if (code === 'last_administrator') return 'Нельзя выключить последнего администратора';
  if (code === 'invalid_settings') return 'Проверьте настройки карточки оценки';
  if (code === 'stage_set_is_fixed') return 'Набор этапов фиксирован';
  if (code === 'manager_owned_by_plugin') return 'Имя менеджера из плагина меняет сам плагин';
  if (code === 'invalid_input') return 'У скрипта нужны название и текст';
  if (code === 'recording_missing') return 'Записи нет';
  if (isMissingEndpoint({ status, body })) return 'Сервер пока не отдаёт этот раздел';
  return 'Не удалось выполнить запрос';
}

export function isMissingEndpoint(error) {
  const message = error?.body?.message;
  return error?.status === 404 && typeof message === 'string' && message.startsWith('Cannot ');
}

export function formatDuration(seconds) {
  if (seconds === null || seconds === undefined || seconds === '') return '—';
  const value = Number(seconds);
  if (!Number.isFinite(value) || value < 0) return '—';
  const total = Math.round(value);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function formatClock(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const secs = total % 60;
  const mins = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  if (hours > 0) return `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function formatTimecode(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const total = Math.floor(seconds);
  const secs = total % 60;
  const mins = Math.floor(total / 60);
  if (mins >= 60) {
    const hours = Math.floor(mins / 60);
    return `${hours}:${String(mins % 60).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function todayInTimeZone(timeZone, now = new Date()) {
  const parts = zoneParts(timeZone || 'Europe/Moscow', now);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function formatDateTime(iso, timeZone) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const parts = zoneParts(timeZone || 'Europe/Moscow', date);
  return `${parts.day}.${parts.month}.${parts.year} ${parts.hour}:${parts.minute}`;
}

export function formatDate(iso, timeZone) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const parts = zoneParts(timeZone || 'Europe/Moscow', date);
  return `${parts.day}.${parts.month}.${parts.year}`;
}

export function nowDateTimeLocal(timeZone, now = new Date()) {
  const parts = zoneParts(timeZone || 'Europe/Moscow', now);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function zonedIso(dateTimeLocal, timeZone) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(dateTimeLocal || '');
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const zone = timeZone || 'Europe/Moscow';
  const wall = Date.UTC(year, month - 1, day, hour, minute, 0);
  let offset = zoneOffsetMinutes(zone, wall);
  let utc = wall - offset * 60_000;
  offset = zoneOffsetMinutes(zone, utc);
  utc = wall - offset * 60_000;
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  const hours = String(Math.floor(abs / 60)).padStart(2, '0');
  const minutes = String(abs % 60).padStart(2, '0');
  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:00${sign}${hours}:${minutes}`;
}

export function readCallsQuery(search, timeZone) {
  const params = asParams(search);
  const periodAll = params.get('period') === 'all';
  let dateFrom = params.get('date_from') || '';
  let dateTo = params.get('date_to') || '';
  let appliedDefault = false;
  if (!periodAll && !params.has('date_from') && !params.has('date_to')) {
    const today = todayInTimeZone(timeZone);
    dateFrom = today;
    dateTo = today;
    appliedDefault = true;
  }
  return {
    manager: params.get('manager') || '',
    dateFrom,
    dateTo,
    period: periodAll ? 'all' : '',
    q: params.get('q') || '',
    dealStatus: params.get('deal_status') || '',
    fieldKey: params.get('field_key') || '',
    fieldValue: params.get('field_value') || '',
    sort: params.get('sort') || 'started_at',
    order: params.get('order') === 'asc' ? 'asc' : 'desc',
    page: positiveInt(params.get('page'), 1),
    perPage: normalizePerPage(params.get('per_page')),
    appliedDefault,
  };
}

export function callsPageSearch(state) {
  const params = new URLSearchParams();
  if (state.period === 'all') {
    params.set('period', 'all');
  } else {
    if (state.dateFrom) params.set('date_from', state.dateFrom);
    if (state.dateTo) params.set('date_to', state.dateTo);
  }
  if (state.manager) params.set('manager', state.manager);
  if (state.q) params.set('q', state.q);
  if (state.dealStatus) params.set('deal_status', state.dealStatus);
  if (state.fieldKey) params.set('field_key', state.fieldKey);
  if (state.fieldValue) params.set('field_value', state.fieldValue);
  if (state.sort && state.sort !== 'started_at') params.set('sort', state.sort);
  if (state.order && state.order !== 'desc') params.set('order', state.order);
  if (state.page && state.page !== 1) params.set('page', String(state.page));
  if (state.perPage && state.perPage !== 50) params.set('per_page', String(state.perPage));
  return params;
}

export function callsApiSearch(state, view) {
  const params = new URLSearchParams();
  if (view) params.set('view', view);
  if (state.manager) params.set('manager_id', state.manager);
  if (state.dateFrom) params.set('date_from', state.dateFrom);
  if (state.dateTo) params.set('date_to', state.dateTo);
  if (state.q) params.set('q', state.q);
  if (state.dealStatus) params.set('deal_status', state.dealStatus);
  if (state.fieldKey && state.fieldValue) {
    params.set('field_key', state.fieldKey);
    params.set('field_value', state.fieldValue);
  }
  params.set('sort', state.sort || 'started_at');
  params.set('order', state.order === 'asc' ? 'asc' : 'desc');
  params.set('page', String(state.page || 1));
  params.set('per_page', String(state.perPage || 50));
  return params;
}

export function readManagersQuery(search, timeZone) {
  const params = asParams(search);
  const periodAll = params.get('period') === 'all';
  let dateFrom = params.get('date_from') || '';
  let dateTo = params.get('date_to') || '';
  let appliedDefault = false;
  if (!periodAll && !params.has('date_from') && !params.has('date_to')) {
    const today = todayInTimeZone(timeZone);
    dateFrom = today;
    dateTo = today;
    appliedDefault = true;
  }
  const sort = params.get('sort') || 'overall';
  return {
    dateFrom,
    dateTo,
    period: periodAll ? 'all' : '',
    q: params.get('q') || '',
    sort,
    order: params.get('order') === 'asc' ? 'asc' : 'desc',
    appliedDefault,
  };
}

export function managersPageSearch(state) {
  const params = new URLSearchParams();
  if (state.period === 'all') params.set('period', 'all');
  else {
    if (state.dateFrom) params.set('date_from', state.dateFrom);
    if (state.dateTo) params.set('date_to', state.dateTo);
  }
  if (state.q) params.set('q', state.q);
  if (state.sort && state.sort !== 'overall') params.set('sort', state.sort);
  if (state.order && state.order !== 'desc') params.set('order', state.order);
  return params;
}

export function managersApiSearch(state) {
  const params = new URLSearchParams();
  if (state.dateFrom) params.set('date_from', state.dateFrom);
  if (state.dateTo) params.set('date_to', state.dateTo);
  params.set('sort', state.sort || 'overall');
  params.set('order', state.order === 'asc' ? 'asc' : 'desc');
  return params;
}

export function toggleSort(currentSort, currentOrder, nextSort) {
  if (currentSort === nextSort) {
    return { sort: nextSort, order: currentOrder === 'asc' ? 'desc' : 'asc' };
  }
  const ascFirst = nextSort === 'manager' || nextSort === 'name';
  return { sort: nextSort, order: ascFirst ? 'asc' : 'desc' };
}

export function stageColumns(filterStages) {
  if (Array.isArray(filterStages) && filterStages.length > 0) {
    return filterStages
      .filter((stage) => stage && typeof stage.key === 'string' && stage.key)
      .map((stage) => ({
        key: stage.key,
        title:
          typeof stage.title === 'string' && stage.title.trim()
            ? stage.title.trim()
            : DEFAULT_STAGE_TITLES[stage.key] || stage.key,
      }));
  }
  return STAGE_ORDER.map((key) => ({ key, title: DEFAULT_STAGE_TITLES[key] }));
}

export function stageScore(stages, key) {
  if (!Array.isArray(stages)) return null;
  const found = stages.find((stage) => stage && stage.key === key);
  if (!found || found.score === null || found.score === undefined) return null;
  return found.score;
}

export function capabilities(me, projectId) {
  const none = {
    role: null,
    read: false,
    write: false,
    problems: false,
    settings: false,
    accounts: false,
    createProject: false,
  };
  if (!me) return none;
  if (me.is_administrator) {
    return {
      role: 'administrator',
      read: true,
      write: true,
      problems: true,
      settings: true,
      accounts: true,
      createProject: true,
    };
  }
  const membership = Array.isArray(me.projects)
    ? me.projects.find((item) => item.id === projectId)
    : undefined;
  if (membership?.role === 'lead') {
    return { ...none, role: 'lead', read: true, write: true, problems: true };
  }
  if (membership?.role === 'sales_manager') {
    return { ...none, role: 'sales_manager', read: true };
  }
  return none;
}

export function routeAllowed(routeName, caps) {
  switch (routeName) {
    case 'accounts':
      return Boolean(caps?.accounts);
    case 'settings':
      return Boolean(caps?.settings);
    case 'inputs':
    case 'call-new':
      return Boolean(caps?.write);
    case 'problems':
    case 'progress':
      return Boolean(caps?.problems);
    case 'calls':
    case 'call':
    case 'managers':
    case 'manager':
      return Boolean(caps?.read);
    default:
      return true;
  }
}

export function roleLabel(role) {
  if (role === 'administrator') return 'Администратор';
  if (role === 'lead') return 'Руководитель';
  if (role === 'sales_manager') return 'Менеджер по продажам';
  return '';
}

export function speakerLabel(speaker) {
  if (speaker === 'manager') return 'Менеджер';
  if (speaker === 'client') return 'Клиент';
  return 'Реплика';
}

export function directionLabel(direction) {
  if (direction === 'in') return 'Входящий';
  if (direction === 'out') return 'Исходящий';
  return '';
}

export function safeHttpUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.href;
  } catch {
    return null;
  }
}

export function safeNext(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return '/';
  }
  return value;
}

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function parseRoute(pathname) {
  if (pathname === '/login') return { name: 'login' };
  if (pathname === '/accounts') return { name: 'accounts' };
  if (pathname === '/') return { name: 'projects' };
  let match = /^\/p\/([^/]+)\/calls\/new$/.exec(pathname);
  if (match) return { name: 'call-new', projectId: decodeURIComponent(match[1]) };
  match = /^\/p\/([^/]+)\/calls\/([^/]+)$/.exec(pathname);
  if (match) {
    return {
      name: 'call',
      projectId: decodeURIComponent(match[1]),
      callId: decodeURIComponent(match[2]),
    };
  }
  match = /^\/p\/([^/]+)\/calls$/.exec(pathname);
  if (match) return { name: 'calls', projectId: decodeURIComponent(match[1]) };
  match = /^\/p\/([^/]+)\/problems$/.exec(pathname);
  if (match) return { name: 'problems', projectId: decodeURIComponent(match[1]) };
  match = /^\/p\/([^/]+)\/progress$/.exec(pathname);
  if (match) return { name: 'progress', projectId: decodeURIComponent(match[1]) };
  match = /^\/p\/([^/]+)\/managers\/([^/]+)$/.exec(pathname);
  if (match) {
    return {
      name: 'manager',
      projectId: decodeURIComponent(match[1]),
      managerId: decodeURIComponent(match[2]),
    };
  }
  match = /^\/p\/([^/]+)\/managers$/.exec(pathname);
  if (match) return { name: 'managers', projectId: decodeURIComponent(match[1]) };
  match = /^\/p\/([^/]+)\/settings$/.exec(pathname);
  if (match) return { name: 'settings', projectId: decodeURIComponent(match[1]) };
  match = /^\/p\/([^/]+)\/inputs$/.exec(pathname);
  if (match) return { name: 'inputs', projectId: decodeURIComponent(match[1]) };
  return { name: 'not-found' };
}

export function projectPath(projectId, tail, params) {
  const path = `/p/${encodeURIComponent(projectId)}/${tail}`;
  const query = params instanceof URLSearchParams ? params.toString() : '';
  return query ? `${path}?${query}` : path;
}

export function pluginConnectPath(provider, setupCode) {
  const prefix = provider === 'amocrm' ? '/plugins/amocrm' : `/plugins/${encodeURIComponent(provider)}`;
  return `${prefix}/connect?setup_code=${encodeURIComponent(setupCode)}`;
}

export function plural(count, one, few, many) {
  const abs = Math.abs(Number(count)) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

export function initials(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return '•';
  return parts
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

function positiveInt(value, fallback) {
  if (value == null || value === '' || !/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : fallback;
}

function normalizePerPage(value) {
  const parsed = positiveInt(value, 50);
  return PER_PAGE.has(parsed) ? parsed : 50;
}

function asParams(search) {
  if (search instanceof URLSearchParams) return search;
  return new URLSearchParams(typeof search === 'string' ? search : '');
}

function zoneParts(timeZone, date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date);
  const pick = (type) => parts.find((part) => part.type === type)?.value ?? '';
  let hour = pick('hour');
  if (hour === '24') hour = '00';
  return {
    year: pick('year'),
    month: pick('month'),
    day: pick('day'),
    hour,
    minute: pick('minute'),
  };
}

function zoneOffsetMinutes(timeZone, utcMs) {
  const parts = zoneParts(timeZone, new Date(utcMs));
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    0,
  );
  return Math.round((asUtc - utcMs) / 60_000);
}
