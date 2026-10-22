import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AuthAccount } from '../src/auth/auth.guard';
import { CallsService, type CreateCallInput } from '../src/calls/calls.service';
import { ApiError } from '../src/errors';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const CALL = '22222222-2222-4222-8222-222222222222';
const ACCOUNT = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  email: 'admin@example.com',
  name: 'Администратор',
  is_administrator: true,
} as AuthAccount;

const PUBLIC_URL = 'https://records.example/a.mp3';

function startedBody(extra: Record<string, unknown> = {}) {
  return {
    started_at: '2026-04-28T16:42:00Z',
    ...extra,
  };
}

function harness(options?: { failSourceUpdate?: boolean; existing?: boolean }) {
  const events: string[] = [];
  const db = {
    async query(sql: string) {
      if (sql.includes("kind = 'manual'")) {
        events.push('source');
        return { rows: [{ id: 'source-1' }], rowCount: 1 };
      }
      if (sql.includes('external_id')) {
        events.push('lookup');
        return options?.existing ? { rows: [{ id: CALL }], rowCount: 1 } : { rows: [], rowCount: 0 };
      }
      if (sql.includes('processing_status from calls')) {
        events.push('preview');
        return { rows: [{ processing_status: 'recording_pending' }], rowCount: 1 };
      }
      events.push('query');
      return { rows: [], rowCount: 0 };
    },
    async tx(fn: (client: { query: (sql: string) => Promise<unknown> }) => Promise<unknown>) {
      const client = {
        async query(sql: string) {
          const label = sql.includes('insert into calls')
            ? 'insert'
            : sql.includes('for update')
              ? 'lock'
              : sql.includes('update calls')
                ? 'update-call'
                : sql.includes('update sources')
                  ? 'update-source'
                  : 'sql';
          events.push(label);
          if (label === 'update-source' && options?.failSourceUpdate) {
            throw new Error('source update failed');
          }
          if (label === 'lock') {
            return {
              rows: [{ processing_status: 'recording_pending', recording_storage_key: null }],
              rowCount: 1,
            };
          }
          return { rows: [], rowCount: 1 };
        },
      };
      try {
        const result = await fn(client);
        events.push('commit');
        return result;
      } catch (error) {
        events.push('rollback');
        throw error;
      }
    },
  };
  const queue = {
    async enqueue() {
      events.push('enqueue');
    },
  };
  const recordings = {
    bucket: 'recordings',
    async put() {
      events.push('put');
    },
    async remove() {
      events.push('remove');
    },
  };
  const access = {
    async require() {
      return {
        id: PROJECT,
        name: 'Проект',
        timezone: 'Europe/Moscow',
        min_call_duration_sec: 180,
      };
    },
  };
  const service = new CallsService(db as never, access as never, queue as never, recordings as never);
  return { service, events };
}

function jsonCall(body: Record<string, unknown>): CreateCallInput {
  return { contentType: 'application/json', body };
}

function fileCall(body: Record<string, unknown>): CreateCallInput {
  return {
    contentType: 'multipart/form-data; boundary=x',
    body: { payload: JSON.stringify(body) },
    file: {
      buffer: Buffer.from('audio'),
      mimetype: 'audio/mpeg',
      originalname: 'call.mp3',
      size: 5,
    },
  };
}

describe('audio fetch is published after commit', () => {
  it('enqueues a new url only after the call row commits', async () => {
    const { service, events } = harness();
    const result = await service.create(
      ACCOUNT,
      PROJECT,
      jsonCall(startedBody({ recording: { type: 'url', url: PUBLIC_URL } })),
    );
    assert.equal(result.status, 201);
    assert.equal(result.body.processing_status, 'audio_queued');
    assert.ok(events.includes('commit'));
    assert.ok(events.indexOf('commit') < events.indexOf('enqueue'));
  });

  it('enqueues a new file only after the call row commits', async () => {
    const { service, events } = harness();
    await service.create(ACCOUNT, PROJECT, fileCall(startedBody()));
    assert.ok(events.indexOf('put') < events.indexOf('commit'));
    assert.ok(events.indexOf('commit') < events.indexOf('enqueue'));
  });

  it('does not leave a redis message when insert rolls back', async () => {
    const { service, events } = harness({ failSourceUpdate: true });
    await assert.rejects(() =>
      service.create(ACCOUNT, PROJECT, jsonCall(startedBody({ recording: { type: 'url', url: PUBLIC_URL } }))),
    );
    assert.equal(events.includes('rollback'), true);
    assert.equal(events.includes('commit'), false);
    assert.equal(events.includes('enqueue'), false);
  });

  it('does not leave a redis message when a file insert rolls back', async () => {
    const { service, events } = harness({ failSourceUpdate: true });
    await assert.rejects(() => service.create(ACCOUNT, PROJECT, fileCall(startedBody())));
    assert.equal(events.includes('rollback'), true);
    assert.equal(events.includes('enqueue'), false);
    assert.equal(events.includes('remove'), true);
  });

  it('enqueues a replayed recording only after the update commits', async () => {
    const { service, events } = harness({ existing: true });
    const result = await service.create(
      ACCOUNT,
      PROJECT,
      jsonCall(startedBody({ external_id: 'ext-1', recording: { type: 'url', url: PUBLIC_URL } })),
    );
    assert.equal(result.status, 200);
    assert.equal(result.body.created, false);
    assert.ok(events.includes('update-call'));
    assert.ok(events.indexOf('commit') < events.indexOf('enqueue'));
  });

  it('does not leave a redis message when replay rolls back', async () => {
    const { service, events } = harness({ existing: true, failSourceUpdate: true });
    await assert.rejects(() =>
      service.create(
        ACCOUNT,
        PROJECT,
        fileCall(startedBody({ external_id: 'ext-1' })),
      ),
    );
    assert.equal(events.includes('rollback'), true);
    assert.equal(events.includes('enqueue'), false);
    assert.equal(events.includes('remove'), true);
  });

  it('rejects an internal recording url with invalid_payload and writes no row', async () => {
    const { service, events } = harness();
    await assert.rejects(
      () =>
        service.create(
          ACCOUNT,
          PROJECT,
          jsonCall(startedBody({ recording: { type: 'url', url: 'http://minio:9000/recordings/a.mp3' } })),
        ),
      (error: unknown) => error instanceof ApiError && error.status === 422 && error.body.error === 'invalid_payload',
    );
    assert.equal(events.includes('insert'), false);
    assert.equal(events.includes('commit'), false);
    assert.equal(events.includes('enqueue'), false);
  });
});
