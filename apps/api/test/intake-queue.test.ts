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

function harness(options?: { failSourceUpdate?: boolean; existing?: boolean; failCommit?: boolean }) {
  const events: string[] = [];
  const callFind = async (args: { where?: Record<string, unknown>; select?: Record<string, boolean> }) => {
    const where = args.where ?? {};
    const select = args.select ?? {};
    if (where.external_id && select.recording_storage_key) {
      events.push('attach-preview');
      return { id: CALL, processing_status: 'recording_pending', recording_storage_key: null };
    }
    if (where.external_id || where.idempotency_key) {
      events.push('lookup');
      return options?.existing ? { id: CALL, source_id: 'source-1' } : null;
    }
    if (select.processing_status && where.id) {
      events.push('preview');
      return { processing_status: 'recording_pending' };
    }
    events.push('query');
    return null;
  };
  const sourceUpdate = async () => {
    events.push('update-source');
    if (options?.failSourceUpdate) {
      throw new Error('source update failed');
    }
    return {};
  };
  const txClient = () => ({
    call: {
      findFirst: callFind,
      async create() {
        events.push('insert');
        return { id: CALL };
      },
      async update() {
        events.push('update-call');
        return {};
      },
    },
    source: {
      async findFirst(args: { where?: { kind?: string } }) {
        if (args.where?.kind === 'manual') {
          events.push('source');
          return { id: 'source-1' };
        }
        events.push('query');
        return null;
      },
      update: sourceUpdate,
    },
    manager: {
      async findFirst() {
        return null;
      },
      async create() {
        return {};
      },
    },
    contact: {
      async create() {
        return {};
      },
    },
    async $queryRawUnsafe(sql: string) {
      if (sql.includes('for update')) {
        events.push('lock');
        return [{ id: CALL, processing_status: 'recording_pending', recording_storage_key: null }];
      }
      events.push('sql');
      return [];
    },
  });
  const db = {
    client: {
      call: { findFirst: callFind },
      source: {
        async findFirst(args: { where?: { kind?: string } }) {
          if (args.where?.kind === 'manual') {
            events.push('source');
            return { id: 'source-1' };
          }
          events.push('query');
          return null;
        },
        update: sourceUpdate,
      },
      async $transaction(fn: (tx: ReturnType<typeof txClient>) => Promise<unknown>) {
        try {
          const result = await fn(txClient());
          if (options?.failCommit) {
            events.push('rollback');
            throw new Error('commit failed');
          }
          events.push('commit');
          return result;
        } catch (error) {
          if (!events.includes('rollback')) events.push('rollback');
          throw error;
        }
      },
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
  const sourceTokens = {
    async requireProject() {
      return {
        id: PROJECT,
        name: 'Проект',
        timezone: 'Europe/Moscow',
        min_call_duration_sec: 180,
      };
    },
  };
  const service = new CallsService(
    db as never,
    access as never,
    sourceTokens as never,
    queue as never,
    recordings as never,
  );
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
      { account: ACCOUNT },
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
    await service.create({ account: ACCOUNT }, PROJECT, fileCall(startedBody()));
    assert.ok(events.indexOf('put') < events.indexOf('commit'));
    assert.ok(events.indexOf('commit') < events.indexOf('enqueue'));
  });

  it('does not leave a redis message when insert rolls back', async () => {
    const { service, events } = harness({ failSourceUpdate: true });
    await assert.rejects(() =>
      service.create({ account: ACCOUNT }, PROJECT, jsonCall(startedBody({ recording: { type: 'url', url: PUBLIC_URL } }))),
    );
    assert.equal(events.includes('rollback'), true);
    assert.equal(events.includes('commit'), false);
    assert.equal(events.includes('enqueue'), false);
  });

  it('does not leave a redis message when a file insert rolls back', async () => {
    const { service, events } = harness({ failSourceUpdate: true });
    await assert.rejects(() => service.create({ account: ACCOUNT }, PROJECT, fileCall(startedBody())));
    assert.equal(events.includes('rollback'), true);
    assert.equal(events.includes('enqueue'), false);
    assert.equal(events.includes('remove'), true);
  });

  it('enqueues a replayed recording only after the update commits', async () => {
    const { service, events } = harness({ existing: true });
    const result = await service.create(
      { account: ACCOUNT },
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
        { account: ACCOUNT },
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
          { account: ACCOUNT },
          PROJECT,
          jsonCall(startedBody({ recording: { type: 'url', url: 'http://minio:9000/recordings/a.mp3' } })),
        ),
      (error: unknown) => error instanceof ApiError && error.status === 422 && error.body.error === 'invalid_payload',
    );
    assert.equal(events.includes('insert'), false);
    assert.equal(events.includes('commit'), false);
    assert.equal(events.includes('enqueue'), false);
  });

  it('enqueues a late recording only after the attach commits', async () => {
    const { service, events } = harness();
    const result = await service.attachRecording(
      { id: 'source-1', project_id: PROJECT },
      PROJECT,
      'ext-1',
      jsonCall({ type: 'url', url: PUBLIC_URL }),
    );
    assert.equal(result.status, 202);
    assert.equal(result.body.processing_status, 'audio_queued');
    assert.ok(events.indexOf('commit') < events.indexOf('enqueue'));
  });

  it('does not leave a redis message when attaching a recording rolls back', async () => {
    const { service, events } = harness({ failCommit: true });
    await assert.rejects(() =>
      service.attachRecording(
        { id: 'source-1', project_id: PROJECT },
        PROJECT,
        'ext-1',
        fileCall({}),
      ),
    );
    assert.equal(events.includes('rollback'), true);
    assert.equal(events.includes('commit'), false);
    assert.equal(events.includes('enqueue'), false);
    assert.equal(events.includes('remove'), true);
  });
});
