import assert from 'node:assert/strict';
import test from 'node:test';
import { callsTable, filtersHtml } from '../html/js/view.js';

const call = {
  id: 'c1',
  started_at: '2026-04-28T13:42:00Z',
  duration_sec: 1458,
  company_name: 'ООО Альфа',
  contact: { name: 'Алексей Смирнов', external_url: 'https://example.com/contacts/1' },
  manager: { id: 'm1', name: 'Анна Петрова' },
  deal: {
    name: 'Поставка',
    link_status: 'linked',
    status_at_call_name: 'Переговоры',
    status_name: 'Счет выставлен',
    external_url: 'https://example.com/deals/1',
  },
  stages: [
    { key: 'opening', score: 85 },
    { key: 'needs', score: 70 },
    { key: 'presentation', score: 59 },
  ],
  overall_score: 80,
};

test('calls table uses the current deal stage and score colors', () => {
  const html = callsTable({
    items: [call],
    stages: [
      { key: 'opening', title: 'Открытие' },
      { key: 'needs', title: 'Потребность' },
      { key: 'presentation', title: 'Презентация' },
    ],
    timeZone: 'Europe/Moscow',
    projectId: 'p1',
    showManager: true,
    showScores: true,
    showStatus: false,
    showError: false,
    sort: 'started_at',
    order: 'desc',
  });
  assert.match(html, /Этап сделки/);
  assert.match(html, /Счет выставлен/);
  assert.doesNotMatch(html, /Переговоры/);
  assert.match(html, /28\.04\.2026 16:42/);
  assert.match(html, /24:18/);
  assert.match(html, /score-green">85/);
  assert.match(html, /score-yellow">70/);
  assert.match(html, /score-red">59/);
  assert.match(html, /score-green">80/);
  const points = callsTable({
    items: [{
      ...call,
      stages: [
        { key: 'S1', status: 'scored', score: 4 },
        { key: 'S2', status: 'scored', score: 3 },
        { key: 'S3', status: 'scored', score: 2 },
        { key: 'S4', status: 'not_applicable', score: null },
        { key: 'S5', status: 'unobservable', score: null },
      ],
      overall_score: 60,
    }],
    stages: [
      { key: 'S1', title: 'Контакт' },
      { key: 'S2', title: 'Ситуация' },
      { key: 'S3', title: 'Цель' },
      { key: 'S4', title: 'Барьеры' },
      { key: 'S5', title: 'Путь' },
    ],
    timeZone: 'Europe/Moscow',
    projectId: 'p1',
    showManager: true,
    showScores: true,
    showStatus: false,
    showError: false,
    sort: 'started_at',
    order: 'desc',
  });
  assert.match(points, /score-green">4/);
  assert.match(points, /score-yellow">3/);
  assert.match(points, /score-red">2/);
  assert.match(points, /score-dash/g);
  assert.equal((points.match(/score-dash/g) || []).length, 2);
  assert.match(points, /score-yellow">60/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /https:\/\/example.com\/contacts\/1/);
});

test('empty deal filter is labeled for every deal stage', () => {
  const html = filtersHtml({
    query: {
      manager: '',
      dealStatus: '',
      dateFrom: '2026-10-21',
      dateTo: '2026-10-21',
      period: '',
      q: '',
      fieldKey: '',
      fieldValue: '',
    },
    filters: { managers: [{ id: 'm1', name: 'Анна' }], deal_statuses: ['Переговоры'], stages: [] },
    includeManager: true,
    includeDeal: true,
    includeField: true,
  });
  assert.match(html, /Все стадии/);
  assert.match(html, /Все менеджеры/);
  assert.doesNotMatch(html, /Все этапы/);
});

test('call table uses stage titles and does not add weight or instruction columns', () => {
  const html = callsTable({
    items: [],
    stages: [{ key: 'opening', title: 'Приветствие' }],
    timeZone: 'Europe/Moscow',
    projectId: 'p1',
    showManager: true,
    showScores: true,
    showStatus: false,
    showError: false,
    sort: 'started_at',
    order: 'desc',
  });
  assert.match(html, /Приветствие/);
  assert.match(html, /colspan="7"/);
  assert.doesNotMatch(html, /Формулировка/);
  assert.doesNotMatch(html, /<th>[^<]*Вес/);
});
