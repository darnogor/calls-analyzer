import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AUTH_MODE } from '../src/auth/auth.guard';
import { authorizationPresent, bearerToken, chooseAuth } from '../src/auth/bearer';
import { CallsController } from '../src/calls/calls.controller';
import {
  parseRecordingBody,
  pluginIntakeError,
  recordingAttachOutcome,
  recordingMissingOutcome,
  resolveExistingCall,
  withoutPluginManagerId,
} from '../src/calls/plugin-rules';
import { validateIntake } from '../src/calls/validate-intake';
import { ContactsController } from '../src/directory/contacts.controller';
import { DealsController } from '../src/directory/deals.controller';
import {
  CONTACT_PATCH_SQL,
  DEAL_PATCH_SQL,
  MANAGER_DEACTIVATE_SQL,
  externalIdsToDeactivate,
  parseContactPatch,
  parseDealPatch,
  parseManagerDirectory,
} from '../src/directory/parse';
import { ManagersController } from '../src/managers/managers.controller';
import { presentMinCallDuration } from '../src/projects/settings.service';
import { SettingsController } from '../src/projects/settings.controller';

const SOURCE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('source token choice', () => {
  it('uses the bearer token for plugin routes and keeps screen routes on the session', () => {
    assert.equal(chooseAuth(true, 'source', 'Bearer secret'), 'public');
    assert.equal(chooseAuth(false, 'source', undefined), 'source');
    assert.equal(chooseAuth(false, 'session_or_source', 'Bearer secret'), 'source');
    assert.equal(chooseAuth(false, 'session_or_source', undefined), 'session');
    assert.equal(chooseAuth(false, 'session', 'Bearer secret'), 'session');
    assert.equal(chooseAuth(false, undefined, undefined), 'session');
    assert.equal(authorizationPresent('   '), false);
    assert.equal(bearerToken('bearer secret-token'), 'secret-token');
    assert.equal(bearerToken('Basic secret'), null);
  });
});

describe('plugin call payload', () => {
  it('requires external ids only for the plugin and still accepts a manual call without them', () => {
    const manual = validateIntake({
      started_at: '2026-04-28T16:42:00+03:00',
      manager: { name: 'Анна' },
      contact: { name: 'Алексей' },
    });
    assert.equal(manual.ok, true);
    if (!manual.ok) return;
    assert.deepEqual(pluginIntakeError(manual.value), { error: 'external_id_required' });
    assert.deepEqual(
      pluginIntakeError({ ...manual.value, external_id: 'call-1' }),
      { error: 'manager_external_id_required' },
    );
    assert.deepEqual(
      pluginIntakeError({
        external_id: 'call-1',
        manager: { external_id: 'user-1' },
        contact: { name: 'Алексей' },
      }),
      { error: 'contact_external_id_required' },
    );
    assert.equal(
      pluginIntakeError({
        external_id: 'call-1',
        manager: { external_id: 'user-1', name: 'Анна' },
        contact: { external_id: 'contact-1', name: 'Алексей' },
      }),
      null,
    );
  });

  it('matches a plugin manager by external id and keeps an idempotency hit on the same source', () => {
    const intake = validateIntake({
      started_at: '2026-04-28T16:42:00Z',
      external_id: 'call-1',
      manager: { id: '11111111-1111-4111-8111-111111111111', external_id: 'user-1', name: 'Анна' },
    });
    assert.equal(intake.ok, true);
    if (!intake.ok || !intake.value.manager) return;
    const plugin = withoutPluginManagerId(intake.value);
    assert.equal(plugin.manager?.id, undefined);
    assert.equal(plugin.manager?.external_id, 'user-1');

    const same = { id: 'call', source_id: SOURCE };
    assert.deepEqual(resolveExistingCall(SOURCE, same, { id: 'call' }), { ok: true, id: 'call' });
    assert.deepEqual(resolveExistingCall(SOURCE, null, { id: 'call' }), { ok: true, id: 'call' });
    assert.deepEqual(resolveExistingCall(SOURCE, null, null), { ok: true, id: null });
    assert.deepEqual(resolveExistingCall(SOURCE, { id: 'other-call', source_id: OTHER }, null), { ok: false });
    assert.deepEqual(resolveExistingCall(SOURCE, same, { id: 'different' }), { ok: false });
  });
});

describe('late recording', () => {
  it('queues a pending call and a call marked missing, and refuses a finished call', () => {
    assert.deepEqual(recordingAttachOutcome({ processing_status: 'recording_pending', recording_storage_key: null }), {
      http: 202,
      processing_status: 'audio_queued',
      enqueue: true,
    });
    assert.deepEqual(
      recordingAttachOutcome({
        processing_status: 'recording_missing',
        recording_storage_key: 'projects/p/calls/c.mp3',
      }),
      { http: 202, processing_status: 'audio_queued', enqueue: true },
    );
    for (const status of ['completed', 'skipped_short', 'skipped_no_duration', 'failed']) {
      const outcome = recordingAttachOutcome({
        processing_status: status,
        recording_storage_key: 'projects/p/calls/c.mp3',
      });
      assert.deepEqual(outcome, { http: 409, error: 'recording_not_accepted', enqueue: false });
    }
    assert.deepEqual(
      recordingAttachOutcome({ processing_status: 'audio_queued', recording_storage_key: 'projects/p/calls/c.mp3' }),
      { http: 200, processing_status: 'audio_queued', enqueue: false },
    );
    assert.deepEqual(recordingAttachOutcome({ processing_status: 'transcribing', recording_storage_key: null }), {
      http: 200,
      processing_status: 'transcribing',
      enqueue: false,
    });
    assert.deepEqual(parseRecordingBody({ type: 'url', url: ' https://records.example/abc.mp3 ' }), {
      type: 'url',
      url: 'https://records.example/abc.mp3',
    });
    assert.equal(parseRecordingBody({ type: 'file', url: 'https://records.example/abc.mp3' }), null);
  });

  it('marks a recording missing only while the call is still waiting for a file', () => {
    assert.deepEqual(recordingMissingOutcome('recording_pending'), {
      http: 200,
      processing_status: 'recording_missing',
    });
    for (const status of ['recording_missing', 'audio_queued', 'completed', 'failed']) {
      assert.deepEqual(recordingMissingOutcome(status), { http: 409, error: 'recording_already_attached' });
    }
  });
});

describe('plugin directory', () => {
  it('replaces the source directory and leaves managers omitted from the list inactive', () => {
    const parsed = parseManagerDirectory({
      items: [
        { external_id: ' user-1 ', name: ' Анна ', email: 'anna@example.com', is_active: true },
        { external_id: 'user-2', name: 'Борис', is_active: false },
      ],
    });
    assert.deepEqual(parsed?.items.map((item) => item.external_id), ['user-1', 'user-2']);
    assert.equal(parsed?.items[0]?.emailProvided, true);
    assert.equal(parsed?.items[1]?.emailProvided, false);
    assert.equal(parseManagerDirectory({ items: [{ external_id: 'user-1', name: 'Анна', is_active: 'true' }] }), null);
    assert.equal(
      parseManagerDirectory({
        items: [
          { external_id: 'user-1', name: 'Анна', is_active: true },
          { external_id: 'user-1', name: 'Анна', is_active: false },
        ],
      }),
      null,
    );
    assert.deepEqual(parseManagerDirectory({ items: [] })?.items, []);
    assert.deepEqual(externalIdsToDeactivate(['user-1', 'user-2', 'user-3'], ['user-1']), ['user-2', 'user-3']);
    assert.deepEqual(externalIdsToDeactivate(['user-1'], []), ['user-1']);
    assert.match(MANAGER_DEACTIVATE_SQL, /source_id = \$2/);
    assert.match(MANAGER_DEACTIVATE_SQL, /external_id is not null/);
  });

  it('updates the contact directory and keeps the call company and deal name as snapshots', () => {
    assert.deepEqual(parseContactPatch({
      name: ' Алексей ',
      company_name: ' ООО Бета ',
      external_url: 'https://crm.example/contacts/456',
    }), {
      name: 'Алексей',
      company_name: 'ООО Бета',
      external_url: 'https://crm.example/contacts/456',
    });
    assert.match(CONTACT_PATCH_SQL, /update contacts/);
    assert.match(CONTACT_PATCH_SQL, /company_name =/);
    assert.doesNotMatch(CONTACT_PATCH_SQL, /update calls/);

    const deal = parseDealPatch({
      name: 'Новое название',
      status_at_call_name: 'Старая стадия',
      current_status_name: ' Счет выставлен ',
      external_url: 'https://crm.example/deals/789',
    });
    assert.deepEqual(deal, {
      current_status_name: 'Счет выставлен',
      external_url: 'https://crm.example/deals/789',
    });
    assert.equal('name' in (deal ?? {}), false);
    assert.match(DEAL_PATCH_SQL, /current_deal_status_name =/);
    assert.match(DEAL_PATCH_SQL, /deal_external_url =/);
    assert.match(DEAL_PATCH_SQL, /source_id = \$2/);
    assert.doesNotMatch(DEAL_PATCH_SQL, /deal_name\s*=/);
    assert.doesNotMatch(DEAL_PATCH_SQL, /deal_status_at_call_name\s*=/);
    assert.doesNotMatch(DEAL_PATCH_SQL, /company_name\s*=/);
  });
});

describe('min call duration', () => {
  it('returns only the threshold', () => {
    const body = presentMinCallDuration(180);
    assert.deepEqual(body, { min_call_duration_sec: 180 });
    assert.deepEqual(Object.keys(body), ['min_call_duration_sec']);
  });
});

describe('route auth', () => {
  it('assigns the source token to plugin routes and leaves settings on the session', () => {
    assert.equal(authMode(CallsController.prototype.create), 'session_or_source');
    assert.equal(authMode(CallsController.prototype.attachRecording), 'source');
    assert.equal(authMode(CallsController.prototype.markRecordingMissing), 'source');
    assert.equal(authMode(SettingsController.prototype.minCallDuration), 'source');
    assert.equal(authMode(SettingsController.prototype.get), undefined);
    assert.equal(authMode(SettingsController.prototype.replace), undefined);
    assert.equal(authMode(ManagersController.prototype.sync), 'source');
    assert.equal(authMode(ManagersController.prototype.rename), undefined);
    assert.equal(authMode(ContactsController.prototype.patchByExternalId), 'source');
    assert.equal(authMode(DealsController.prototype.patchByExternalId), 'source');
  });
});

function authMode(method: object): string | undefined {
  return Reflect.getMetadata(AUTH_MODE, method) as string | undefined;
}
