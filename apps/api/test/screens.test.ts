import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decideProjectAccess } from '../src/access';
import { recordingContentType } from '../src/calls/audio-ext';
import { ApiError } from '../src/errors';
import {
  parseAccountPatch,
  parseMemberships,
  parseNewAccount,
  removesLastActiveAdministrator,
} from '../src/accounts/validate-account';
import { parseScript } from '../src/inputs/validate-script';
import { parseManagerName, parseManagerQuery } from '../src/managers/manager-query';
import { aggregateManagers, roundAverage, sortManagers, type ManagerCallRow } from '../src/managers/present-manager';
import { DEFAULT_STAGES } from '../src/projects/defaults';
import type { Stage } from '../src/projects/scorecard';
import { parseSettings } from '../src/projects/validate-settings';
import { secretHash } from '../src/sources/secrets';
import { parseNewSource, parseSetupCode } from '../src/sources/validate-source';

const STAGES: Stage[] = [
  { key: 'opening', title: 'Открытие', weight: 0.15, instruction: 'контакт' },
  { key: 'needs', title: 'Потребность', weight: 0.3, instruction: 'вопросы' },
  { key: 'presentation', title: 'Презентация', weight: 0.2, instruction: 'предложение' },
  { key: 'objections', title: 'Возражения', weight: 0.2, instruction: 'цена' },
  { key: 'closing', title: 'Закрытие', weight: 0.15, instruction: 'шаг' },
];

describe('project roles', () => {
  it('lets every member read, and only an administrator change the scorecard', () => {
    assert.equal(decideProjectAccess(true, null, 'settings'), 'ok');
    assert.equal(decideProjectAccess(false, 'lead', 'settings'), 'forbidden');
    assert.equal(decideProjectAccess(false, 'sales_manager', 'settings'), 'forbidden');
    assert.equal(decideProjectAccess(false, 'sales_manager', 'read'), 'ok');
    assert.equal(decideProjectAccess(false, 'sales_manager', 'write'), 'forbidden');
    assert.equal(decideProjectAccess(false, 'sales_manager', 'problems'), 'forbidden');
    assert.equal(decideProjectAccess(false, 'lead', 'write'), 'ok');
    assert.equal(decideProjectAccess(false, 'lead', 'problems'), 'ok');
    assert.equal(decideProjectAccess(false, null, 'read'), 'not_found');
  });
});

describe('analysis settings', () => {
  it('accepts the five default stages and rejects another set', () => {
    const parsed = parseSettings({
      timezone: 'Europe/Moscow',
      min_call_duration_sec: 180,
      stages: DEFAULT_STAGES,
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.deepEqual(parsed.value.stages.map((stage) => stage.key), [
      'opening',
      'needs',
      'presentation',
      'objections',
      'closing',
    ]);
    assert.equal(parseSettings({ timezone: 'Europe/Moscow', min_call_duration_sec: 180, stages: STAGES.slice(0, 4) }).ok, false);
    const wrong = parseSettings({
      timezone: 'Europe/Moscow',
      min_call_duration_sec: 180,
      stages: STAGES.map((stage, index) => (index === 0 ? { ...stage, key: 'hello' } : stage)),
    });
    assert.equal(wrong.ok, false);
    if (wrong.ok) return;
    assert.equal(wrong.error, 'stage_set_is_fixed');
  });

  it('reports a weight total that is not 1 and a bad timezone', () => {
    const weights = parseSettings({
      timezone: 'Europe/Moscow',
      min_call_duration_sec: 180,
      stages: STAGES.map((stage, index) => (index === 0 ? { ...stage, weight: 0.5 } : stage)),
    });
    assert.equal(weights.ok, false);
    if (weights.ok || weights.error !== 'invalid_settings') return;
    assert.deepEqual(weights.details, ['weights_sum_must_be_1']);

    const zone = parseSettings({
      timezone: 'Not/AZone',
      min_call_duration_sec: 0,
      stages: STAGES,
    });
    assert.equal(zone.ok, false);
    if (zone.ok || zone.error !== 'invalid_settings') return;
    assert.deepEqual(zone.details, ['timezone', 'min_call_duration_sec']);
  });
});

describe('manager summary', () => {
  it('uses the latest completed call in the period and drops an inactive manager without calls', () => {
    const items = aggregateManagers(
      [
        row({ id: 'a', started_at: new Date('2026-10-01T09:00:00Z'), overall_score: 80, stages_json: score(70) }),
        row({ id: 'a', started_at: new Date('2026-10-13T15:40:00Z'), overall_score: 90, stages_json: score(80) }),
        row({ id: 'b', is_active: true, started_at: null, overall_score: null, stages_json: null }),
        row({ id: 'c', name: 'Старый', is_active: false, started_at: null, overall_score: null, stages_json: null }),
      ],
      STAGES,
      { includeEmail: false, dropInactiveWithoutCalls: true },
    );
    assert.equal(items.length, 2);
    assert.equal(items[0]?.calls_count, 2);
    assert.equal(items[0]?.overall_score, 85);
    assert.equal(items[0]?.last_call_at, '2026-10-13T15:40:00.000Z');
    assert.equal(items[0]?.stages[0]?.score, 75);
    assert.equal('weight' in (items[0]?.stages[0] ?? {}), false);
    assert.equal('instruction' in (items[0]?.stages[0] ?? {}), false);
    assert.equal('email' in (items[0] ?? {}), false);
    assert.equal(items[1]?.id, 'b');
    assert.equal(items[1]?.calls_count, 0);
    assert.equal(items[1]?.overall_score, null);
    assert.equal(items[1]?.last_call_at, null);
    assert.equal(items[1]?.stages[0]?.score, null);
  });

  it('keeps an empty score at the end for both sort directions', () => {
    const scored = aggregateManagers(
      [
        row({ id: 'low', name: 'Борис', started_at: new Date('2026-10-02T00:00:00Z'), overall_score: 40 }),
        row({ id: 'high', name: 'Анна', started_at: new Date('2026-10-03T00:00:00Z'), overall_score: 90 }),
        row({ id: 'none', name: 'Вера', is_active: true, started_at: null, overall_score: null }),
      ],
      STAGES,
      { includeEmail: false, dropInactiveWithoutCalls: true },
    );
    const desc = sortManagers(scored, { kind: 'overall' }, 'desc').map((item) => item.id);
    const asc = sortManagers(scored, { kind: 'overall' }, 'asc').map((item) => item.id);
    assert.deepEqual(desc, ['high', 'low', 'none']);
    assert.deepEqual(asc, ['low', 'high', 'none']);
    assert.equal(roundAverage([80, 81]), 81);
    assert.equal(roundAverage([null, undefined]), null);
  });

  it('defaults the manager query and rejects an unknown stage', () => {
    const parsed = parseManagerQuery({}, STAGES.map((stage) => stage.key));
    assert.deepEqual(parsed, { sort: { kind: 'overall' }, order: 'desc' });
    assert.equal(parseManagerName({ name: '  Анна Петрова ' }), 'Анна Петрова');
    assert.equal(parseManagerName({ name: '   ' }), null);
    assert.throws(
      () => parseManagerQuery({ sort: 'stage.missing' }, ['opening']),
      (error: unknown) => error instanceof ApiError && error.status === 400 && error.body.error === 'invalid_query',
    );
  });
});

describe('accounts, scripts and sources', () => {
  it('normalizes a new account and blocks the last active administrator', () => {
    assert.deepEqual(parseNewAccount({
      email: 'Lead@Client.Example',
      name: ' Сергей ',
      password: 'secret',
      is_administrator: false,
    }), {
      email: 'lead@client.example',
      name: 'Сергей',
      password: 'secret',
      is_administrator: false,
    });
    assert.equal(parseAccountPatch({ is_active: false })?.is_active, false);
    assert.equal(parseAccountPatch({ is_active: 'false' }), null);
    assert.deepEqual(parseMemberships({
      items: [
        { project_id: 'p1', role: 'lead' },
        { project_id: 'p2', role: 'sales_manager' },
      ],
    })?.length, 2);
    assert.equal(parseMemberships({ items: [{ project_id: 'p1', role: 'lead' }, { project_id: 'p1', role: 'sales_manager' }] }), null);
    const active = { is_administrator: true, is_active: true };
    assert.equal(removesLastActiveAdministrator(active, { is_administrator: true, is_active: false }, 0), true);
    assert.equal(removesLastActiveAdministrator(active, { is_administrator: false, is_active: true }, 0), true);
    assert.equal(removesLastActiveAdministrator(active, { is_administrator: true, is_active: false }, 1), false);
  });

  it('rejects an empty script and a non-script kind', () => {
    assert.deepEqual(parseScript({ title: ' Первый ', body: ' Текст ' }), { title: 'Первый', body: 'Текст' });
    assert.equal(parseScript({ title: ' ', body: 'Текст' }), null);
    assert.equal(parseScript({ title: 'Скрипт', body: 'Текст', kind: 'field' }), null);
    assert.deepEqual(parseScript({ title: 'Скрипт', body: 'Текст', kind: 'script' }), { title: 'Скрипт', body: 'Текст' });
  });

  it('accepts a plugin provider and hashes a setup code', () => {
    assert.deepEqual(parseNewSource({ provider: 'amocrm', display_name: ' amoCRM ' }), {
      provider: 'amocrm',
      display_name: 'amoCRM',
    });
    assert.equal(parseNewSource({ provider: 'amoCRM', display_name: 'amo' }), null);
    assert.equal(parseSetupCode({ setup_code: 'once' }), 'once');
    assert.equal(parseSetupCode({}), null);
    assert.equal(secretHash('once'), secretHash('once'));
    assert.notEqual(secretHash('once'), secretHash('twice'));
  });
});

describe('recording content type', () => {
  it('keeps a media type and drops a header value', () => {
    assert.equal(recordingContentType('audio/mpeg'), 'audio/mpeg');
    assert.equal(recordingContentType('audio/mpeg\r\nX-Evil: 1'), 'application/octet-stream');
    assert.equal(recordingContentType(null), 'application/octet-stream');
  });
});

function row(overrides: Partial<ManagerCallRow>): ManagerCallRow {
  return {
    id: 'a',
    name: 'Анна',
    email: null,
    is_active: true,
    source_kind: 'manual',
    source_provider: null,
    started_at: null,
    overall_score: null,
    stages_json: null,
    ...overrides,
  };
}

function score(opening: number): unknown {
  return [{ key: 'opening', score: opening, title: 'Открытие', weight: 0.15, instruction: 'контакт' }];
}
