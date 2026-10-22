import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { audioObject } from '../src/calls/audio-ext';
import { durationBelowMinimum } from '../src/calls/duration';
import { parseListQuery } from '../src/calls/list-query';
import { presentCall, presentListItem, type CallRow } from '../src/calls/present-call';
import { foldSearch, likeContains } from '../src/calls/search';
import { validateIntake } from '../src/calls/validate-intake';
import { ApiError } from '../src/errors';
import { signSession, verifySession } from '../src/auth/session-token';

const SECRET = 'test-session-secret-value';
const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';

describe('duration', () => {
  it('rejects a known duration below the project threshold and accepts the threshold', () => {
    assert.deepEqual(durationBelowMinimum(40, 180), {
      error: 'duration_below_minimum',
      min_call_duration_sec: 180,
      duration_sec: 40,
    });
    assert.equal(durationBelowMinimum(180, 180), null);
    assert.equal(durationBelowMinimum(undefined, 180), null);
  });
});

describe('intake payload', () => {
  it('accepts a manual call with a deal name and no link status', () => {
    const result = validateIntake({
      started_at: '2026-04-28T16:42:00+03:00',
      direction: 'out',
      phone: '+79990000000',
      duration_sec: 180,
      manager: { name: 'Анна Петрова' },
      contact: { name: 'Алексей Смирнов' },
      company_name: 'ООО Альфа',
      deal: { name: 'Поставка', status_at_call_name: 'Переговоры' },
      context: { notes: 'заметка', fields: [{ key: 'segment', label: 'Сегмент', value: 'enterprise' }] },
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.deal.link_status, 'linked');
    assert.equal(result.value.deal.name, 'Поставка');
    assert.equal(result.value.deal.current_status_name, 'Переговоры');
    assert.equal(result.value.deal.external_id, undefined);
  });

  it('rejects a started_at without a timezone and a linked deal without an external id', () => {
    assert.equal(validateIntake({ started_at: '2026-04-28T16:42:00' }).ok, false);
    assert.equal(
      validateIntake({
        started_at: '2026-04-28T16:42:00Z',
        deal: { link_status: 'linked', name: 'Поставка' },
      }).ok,
      false,
    );
  });

  it('stores an omitted deal as absent and an empty deal block as absent', () => {
    const omitted = validateIntake({ started_at: '2026-04-28T16:42:00Z' });
    const empty = validateIntake({ started_at: '2026-04-28T16:42:00Z', deal: {} });
    assert.equal(omitted.ok && omitted.value.deal.link_status, 'absent');
    assert.equal(empty.ok && empty.value.deal.link_status, 'absent');
  });

  it('requires a manager name when no id is sent', () => {
    assert.equal(
      validateIntake({ started_at: '2026-04-28T16:42:00Z', manager: { email: 'a@b.c' } }).ok,
      false,
    );
  });

  it('accepts an absolute http or https recording url on a public host', () => {
    for (const url of [
      'https://records.example/a.mp3',
      'http://example.com:8080/a',
      'https://cdn.example/a.mp3?x=1',
      'http://api.example.com/x',
      'http://8.8.8.8/a.mp3',
      'http://172.32.5.4/a.mp3',
      'http://[2001:4860:4860::8888]/a',
    ]) {
      const result = validateIntake({
        started_at: '2026-04-28T16:42:00Z',
        recording: { type: 'url', url },
      });
      assert.equal(result.ok, true, url);
      if (result.ok) assert.equal(result.value.recording?.url, url);
    }
  });

  it('rejects a recording url that is not a public http(s) address', () => {
    for (const url of [
      'example.com/file.mp3',
      '//cdn.example/a.mp3',
      '/recordings/a.mp3',
      'javascript:alert(1)',
      'javascript:http://example.com',
      'ftp://example.com/a',
      'file:///etc/passwd',
      'http://localhost/a',
      'http://LOCALHOST/a',
      'http://localhost./a',
      'http://127.0.0.1/a',
      'http://127.1/a',
      'http://2130706433/a',
      'http://[::1]/a',
      'http://[::ffff:127.0.0.1]/a',
      'http://10.1.2.3/a',
      'http://192.168.1.1/a',
      'http://172.16.5.4/a',
      'http://169.254.169.254/latest',
      'http://[::ffff:169.254.169.254]/',
      'http://[fe80::1]/a',
      'http://[fc00::1]/a',
      'http://0.0.0.0/',
      'http://minio/bucket',
      'http://minio:9000/bucket',
      'http://minio./bucket',
      'http://postgres/x',
      'http://redis/x',
      'http://api/x',
      'http://API/x',
      'http://example.com@169.254.169.254/',
    ]) {
      assert.equal(
        validateIntake({ started_at: '2026-04-28T16:42:00Z', recording: { type: 'url', url } }).ok,
        false,
        url,
      );
    }
  });
});

describe('session cookie', () => {
  it('round-trips an account id and rejects a tampered token', () => {
    const token = signSession(ACCOUNT_ID, SECRET);
    assert.equal(verifySession(token, SECRET), ACCOUNT_ID);
    assert.equal(verifySession(`${token}x`, SECRET), null);
    assert.equal(verifySession(token, 'another-session-secret'), null);
  });
});

describe('list query', () => {
  const stages = ['opening', 'needs', 'presentation', 'objections', 'closing'];

  it('defaults to completed calls, newest first, 50 per page', () => {
    assert.deepEqual(parseListQuery({}, stages), {
      view: 'completed',
      sort: 'started_at',
      order: 'desc',
      page: 1,
      perPage: 50,
    });
  });

  it('rejects an unknown stage, a lone field filter, and per_page above 100', () => {
    assert.throws(() => parseListQuery({ sort: 'stage.missing' }, stages), (error: unknown) => {
      return error instanceof ApiError && error.status === 400 && error.body.error === 'invalid_query';
    });
    assert.throws(() => parseListQuery({ field_key: 'segment' }, stages), (error: unknown) => {
      return error instanceof ApiError && error.body.error === 'invalid_query';
    });
    assert.throws(() => parseListQuery({ per_page: '101' }, stages), (error: unknown) => {
      return error instanceof ApiError && error.body.error === 'invalid_query';
    });
  });

  it('accepts a stage sort from the current scorecard', () => {
    const parsed = parseListQuery({ sort: 'stage.objections', order: 'asc', view: 'progress' }, stages);
    assert.equal(parsed.sort, 'stage');
    assert.equal(parsed.stageKey, 'objections');
    assert.equal(parsed.view, 'progress');
  });
});

describe('call presentation', () => {
  it('hides scores until completed and shows the failed error', () => {
    const pending = presentCall(row({ processing_status: 'audio_queued' }));
    assert.equal(pending.stages, null);
    assert.equal(pending.summary, null);
    assert.equal(pending.transcript, null);
    assert.equal(pending.has_recording, false);
    assert.equal('error' in pending, false);

    const failed = presentCall(
      row({
        processing_status: 'failed',
        error: { stage: 'audio', message: 'audio_network_failure', attempts: 3, failed_at: '2026-10-13T12:40:00.000Z' },
      }),
    );
    assert.deepEqual(failed.error, {
      stage: 'audio',
      message: 'audio_network_failure',
      attempts: 3,
      failed_at: '2026-10-13T12:40:00.000Z',
    });
  });

  it('returns an absent deal as null and an ambiguous name as empty', () => {
    assert.equal(presentCall(row({ deal_link_status: 'absent' })).deal, null);
    const ambiguous = presentListItem(row({ deal_link_status: 'ambiguous', deal_name: 'Скрыто' }), 'completed');
    assert.deepEqual(ambiguous.deal, {
      name: '',
      link_status: 'ambiguous',
      status_name: 'Переговоры',
    });
  });
});

describe('audio object name', () => {
  it('uses a known filename extension and keeps the original mime', () => {
    assert.deepEqual(audioObject({ originalname: 'call.mp3', mimetype: 'application/octet-stream' }), {
      ext: 'mp3',
      contentType: 'application/octet-stream',
    });
    assert.equal(audioObject({ originalname: 'call.bin', mimetype: 'application/octet-stream' }).ext, 'bin');
  });
});

describe('search folding', () => {
  it('folds Russian case and escapes like wildcards', () => {
    assert.equal(foldSearch('Альфа'), 'альфа');
    assert.equal(likeContains('100%'), '%100\\%%');
  });
});

function row(overrides: Partial<CallRow>): CallRow {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    started_at: new Date('2026-04-28T13:42:00.000Z'),
    duration_sec: 180,
    direction: 'out',
    phone: '+79990000000',
    company_name: 'ООО Альфа',
    deal_name: 'Поставка',
    deal_link_status: 'linked',
    deal_status_at_call_name: 'Переговоры',
    current_deal_status_name: 'Переговоры',
    deal_external_url: null,
    processing_status: 'completed',
    error: null,
    context_json: { notes: null, fields: [] },
    recording_storage_key: null,
    source_kind: 'manual',
    source_provider: null,
    source_display_name: 'Ручная загрузка',
    manager_id: null,
    manager_name: null,
    contact_id: null,
    contact_name: null,
    contact_external_url: null,
    stages_json: null,
    overall_score: null,
    summary: null,
    transcript_json: null,
    ...overrides,
  };
}
