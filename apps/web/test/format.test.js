import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  ALL_MANAGERS,
  EMPTY_DEAL_STAGE,
  callsApiSearch,
  callsPageSearch,
  capabilities,
  dealAtCallStage,
  dealCurrentStage,
  formatDuration,
  formatTimecode,
  percentsToWeights,
  percentSumIs100,
  pluginConnectPath,
  parseRoute,
  readCallsQuery,
  readManagersQuery,
  routeAllowed,
  stageColumns,
  scoreBand,
  todayInTimeZone,
  translateCallError,
  zonedIso,
} from '../html/js/format.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test('score bands follow 80 / 60 boundaries', () => {
  assert.equal(scoreBand(100), 'green');
  assert.equal(scoreBand(80), 'green');
  assert.equal(scoreBand(79.9), 'yellow');
  assert.equal(scoreBand(60), 'yellow');
  assert.equal(scoreBand(59.9), 'red');
  assert.equal(scoreBand(0), 'red');
  assert.equal(scoreBand(null), null);
  assert.equal(scoreBand(''), null);
});

test('duration and timecodes', () => {
  assert.equal(formatDuration(1458), '24:18');
  assert.equal(formatDuration(0), '0:00');
  assert.equal(formatDuration(null), '—');
  assert.equal(formatTimecode(0), '00:00');
  assert.equal(formatTimecode(72), '01:12');
});

test('project day and zoned form time', () => {
  const now = new Date('2026-04-28T21:30:00Z');
  assert.equal(todayInTimeZone('Europe/Moscow', now), '2026-04-29');
  assert.equal(todayInTimeZone('UTC', now), '2026-04-28');
  assert.equal(zonedIso('2026-04-28T16:42', 'Europe/Moscow'), '2026-04-28T16:42:00+03:00');
  assert.equal(zonedIso('2026-10-21T12:00', 'America/New_York'), '2026-10-21T12:00:00-04:00');
  assert.equal(zonedIso('2026-01-15T12:00', 'America/New_York'), '2026-01-15T12:00:00-05:00');
});

test('in-progress and problems show the whole backlog when the menu link has no dates', () => {
  const zone = 'Europe/Moscow';
  const today = todayInTimeZone(zone);
  for (const screen of ['progress', 'problems']) {
    const state = readCallsQuery('', zone, screen);
    assert.equal(state.dateFrom, '');
    assert.equal(state.dateTo, '');
    assert.equal(state.appliedDefault, false);
    const api = callsApiSearch(state, screen);
    assert.equal(api.has('date_from'), false);
    assert.equal(api.has('date_to'), false);
    const dated = readCallsQuery('date_from=2026-01-01&date_to=2026-01-02', zone, screen);
    assert.equal(dated.dateFrom, '2026-01-01');
    assert.equal(dated.dateTo, '2026-01-02');
    assert.equal(dated.appliedDefault, false);
  }
  const calls = readCallsQuery('', zone, 'calls');
  assert.equal(calls.appliedDefault, true);
  assert.equal(calls.dateFrom, today);
  assert.equal(calls.dateTo, today);
  const managers = readManagersQuery('', zone);
  assert.equal(managers.appliedDefault, true);
  assert.equal(managers.dateFrom, today);
  assert.equal(managers.dateTo, today);
  const pages = readFileSync(join(root, 'html/js/pages.js'), 'utf8');
  assert.match(pages, /readCallsQuery\(ctx\.search, ctx\.timeZone, mode\)/);
});

test('calls page keeps manager, API receives manager_id', () => {
  const state = readCallsQuery('manager=b7e1&sort=stage.objections&order=asc&q=Альфа', 'Europe/Moscow');
  assert.equal(state.manager, 'b7e1');
  assert.equal(state.sort, 'stage.objections');
  assert.equal(state.order, 'asc');
  assert.equal(state.appliedDefault, true);
  const api = callsApiSearch({ ...state, dateFrom: '2026-10-13', dateTo: '2026-10-13' });
  assert.equal(api.get('manager_id'), 'b7e1');
  assert.equal(api.get('manager'), null);
  assert.equal(api.get('deal_status'), null);
  const page = callsPageSearch({ ...state, dateFrom: '2026-10-13', dateTo: '2026-10-13', appliedDefault: false });
  assert.equal(page.get('manager'), 'b7e1');
  assert.equal(page.get('manager_id'), null);
  assert.equal(page.get('date_from'), '2026-10-13');
});

test('empty deal filter is every stage of the deal, not scorecard stages', () => {
  assert.equal(EMPTY_DEAL_STAGE, 'Все стадии');
  assert.equal(ALL_MANAGERS, 'Все менеджеры');
});

test('list shows current deal stage, card separates call-time stage and status', () => {
  const deal = {
    name: 'Поставка',
    link_status: 'linked',
    status_at_call_name: 'Переговоры',
    status_name: 'Счет выставлен',
  };
  assert.equal(dealCurrentStage(deal), 'Счет выставлен');
  assert.equal(dealAtCallStage(deal), 'Переговоры');
  assert.equal(dealCurrentStage(null), '');
  assert.equal(dealCurrentStage({ link_status: 'ambiguous', name: '', status_name: null }), 'Несколько активных сделок');
});

test('call error codes become Russian and unknown codes stay generic', () => {
  assert.equal(translateCallError('empty_transcript'), 'Пустой ответ распознавания');
  assert.equal(translateCallError('audio_object_missing'), 'Файла нет в хранилище');
  assert.equal(translateCallError('something_else'), 'Ошибка обработки');
});

test('sales manager does not see progress or problems', () => {
  const sales = capabilities({ is_administrator: false, projects: [{ id: 'p1', role: 'sales_manager' }] }, 'p1');
  const lead = capabilities({ is_administrator: false, projects: [{ id: 'p1', role: 'lead' }] }, 'p1');
  const admin = capabilities({ is_administrator: true, projects: [] }, 'p1');
  assert.equal(sales.read, true);
  assert.equal(sales.problems, false);
  assert.equal(sales.write, false);
  assert.equal(routeAllowed('progress', sales), false);
  assert.equal(routeAllowed('problems', sales), false);
  assert.equal(routeAllowed('calls', sales), true);
  assert.equal(routeAllowed('call', sales), true);
  assert.equal(routeAllowed('progress', lead), true);
  assert.equal(routeAllowed('settings', lead), false);
  assert.equal(routeAllowed('settings', admin), true);
  assert.equal(routeAllowed('accounts', admin), true);
  assert.equal(routeAllowed('call-new', lead), true);
  assert.equal(routeAllowed('call-new', sales), false);
});

test('routes keep call id separate from the upload path', () => {
  assert.deepEqual(parseRoute('/p/p1/calls/new'), { name: 'call-new', projectId: 'p1' });
  assert.equal(parseRoute('/p/p1/calls/abc').name, 'call');
  assert.equal(parseRoute('/p/p1/progress').name, 'progress');
  assert.equal(parseRoute('/p/p1/problems').name, 'problems');
  assert.equal(parseRoute('/accounts').name, 'accounts');
});

test('weights of the default card sum to 1', () => {
  const percents = [15, 30, 20, 20, 15];
  assert.equal(percentSumIs100(percents), true);
  const weights = percentsToWeights(percents);
  assert.deepEqual(weights, [0.15, 0.3, 0.2, 0.2, 0.15]);
});

test('amoCRM setup opens the plugin prefix', () => {
  assert.equal(pluginConnectPath('amocrm', 'code 1'), '/plugins/amocrm/connect?setup_code=code%201');
  assert.equal(pluginConnectPath('other', 'a'), '/plugins/other/connect?setup_code=a');
});

test('russian plurals', async () => {
  const { plural } = await import('../html/js/format.js');
  assert.equal(plural(1, 'звонок', 'звонка', 'звонков'), 'звонок');
  assert.equal(plural(2, 'звонок', 'звонка', 'звонков'), 'звонка');
  assert.equal(plural(5, 'звонок', 'звонка', 'звонков'), 'звонков');
  assert.equal(plural(12, 'звонок', 'звонка', 'звонков'), 'звонков');
  assert.equal(plural(21, 'звонок', 'звонка', 'звонков'), 'звонок');
});

test('stage columns follow the scorecard and do not invent five keys', () => {
  assert.deepEqual(stageColumns([]), []);
  assert.deepEqual(stageColumns(undefined), []);
});

test('stage columns use filter titles and leave weight and instruction off the column', () => {
  assert.deepEqual(
    stageColumns([
      { key: 'opening', title: 'Приветствие', weight: 0.2, instruction: 'Сказать имя' },
      { key: 'needs', title: '', weight: 0.3, instruction: 'Спросить' },
    ]),
    [
      { key: 'opening', title: 'Приветствие' },
      { key: 'needs', title: 'Потребность' },
    ],
  );
});

test('manager list shows the last completed call', () => {
  const pages = readFileSync(join(root, 'html/js/pages.js'), 'utf8');
  assert.equal(pages.includes('Последний звонок'), true);
  assert.equal(pages.includes('last_call_at'), true);
});

test('interface copy does not use the mock filter label', () => {
  const files = [
    'html/index.html',
    'html/app.css',
    'html/js/format.js',
    'html/js/api.js',
    'html/js/router.js',
    'html/js/view.js',
    'html/js/main.js',
    'html/js/pages.js',
  ];
  const source = files.map((file) => readFileSync(join(root, file), 'utf8')).join('\n');
  assert.equal(source.includes('Все этапы'), false);
  assert.equal(source.includes('Все стадии'), true);
  assert.equal(source.includes('CallMind'), false);
  assert.equal(source.includes('Call Analytics'), true);
});
