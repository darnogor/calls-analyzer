import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { handleTranscribe, type TranscribeDeps } from '../src/handle-transcribe';
import { type TranscribeMessage } from '../src/messages';
import { SpeechTransportError } from '../src/speech';

function message(attempt = 1): TranscribeMessage {
  return {
    message_id: 'm1',
    project_id: 'p1',
    call_id: 'c1',
    attempt,
    enqueued_at: '2026-10-13T09:00:00.000Z',
    audio: { bucket: 'recordings', key: 'projects/p1/calls/c1.wav', content_type: 'audio/wav' },
  };
}

function harness(options: {
  direction?: string | null;
  status?: string;
  transcript?: unknown;
  object?: Buffer | null;
  recognize: TranscribeDeps['recognize'];
}) {
  const saved: unknown[] = [];
  const analyzed: string[] = [];
  const failed: string[] = [];
  const deps: TranscribeDeps = {
    now: () => '2026-10-13T09:02:00.000Z',
    newId: () => 'new-id',
    loadCall: async () => ({
      processing_status: options.status ?? 'audio_fetch',
      direction: options.direction ?? 'out',
    }),
    loadTranscript: async () => (Array.isArray(options.transcript) ? options.transcript : null),
    markTranscribing: async () => undefined,
    ensureAnalysis: async () => undefined,
    getObject: async () => (options.object === null ? null : { body: options.object ?? Buffer.from('audio'), contentType: 'audio/wav' }),
    recognize: options.recognize,
    saveTranscript: async (_callId, replicas) => {
      saved.push(replicas);
    },
    enqueueAnalyze: async (queued) => {
      analyzed.push(queued.call_id);
    },
    fail: async (_projectId, _callId, error) => {
      failed.push(`${error.stage}:${error.message}:${error.attempts}`);
    },
  };
  return { deps, saved, analyzed, failed };
}

describe('transcriber pipeline', () => {
  it('does not skip a single-track call and enqueues analysis with manager and client roles', async () => {
    let calls = 0;
    const fake = harness({
      direction: 'out',
      recognize: async () => {
        calls += 1;
        return {
          segments: [
            { start: 0, end: 1, text: 'Добрый день', speaker: 's1' },
            { start: 1, end: 2, text: 'Здравствуйте', speaker: 's2' },
          ],
        };
      },
    });
    const result = await handleTranscribe(message(), fake.deps);
    assert.equal(result.action, 'ack');
    assert.equal(calls, 1);
    assert.deepEqual(fake.saved[0], [
      { speaker: 'manager', start: 0, end: 1, text: 'Добрый день' },
      { speaker: 'client', start: 1, end: 2, text: 'Здравствуйте' },
    ]);
    assert.deepEqual(fake.analyzed, ['c1']);
  });

  it('publishes analysis without calling speech when the transcript is already stored', async () => {
    let calls = 0;
    const fake = harness({
      transcript: [{ speaker: 'manager', start: 0, end: 1, text: 'уже есть' }],
      recognize: async () => {
        calls += 1;
        return {};
      },
    });
    await handleTranscribe(message(), fake.deps);
    assert.equal(calls, 0);
    assert.deepEqual(fake.saved, []);
    assert.deepEqual(fake.analyzed, ['c1']);
  });

  it('retries an empty transcript and a provider failure, then fails on the third attempt', async () => {
    const empty = harness({ recognize: async () => ({ segments: [] }) });
    const retry = await handleTranscribe(message(1), empty.deps);
    assert.equal(retry.action, 'retry');
    if (retry.action === 'retry') {
      assert.equal(retry.message.attempt, 2);
    }
    assert.deepEqual(empty.failed, []);

    const down = harness({
      recognize: async () => {
        throw new SpeechTransportError('down');
      },
    });
    const failed = await handleTranscribe(message(3), down.deps);
    assert.equal(failed.action, 'ack');
    assert.deepEqual(down.failed, ['transcribe:provider_unavailable:3']);
    assert.deepEqual(down.analyzed, []);

    const missing = harness({ object: null, recognize: async () => ({}) });
    const missingResult = await handleTranscribe(message(3), missing.deps);
    assert.equal(missingResult.action, 'ack');
    assert.deepEqual(missing.failed, ['transcribe:audio_object_missing:3']);
  });
});
