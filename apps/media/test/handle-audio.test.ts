import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { handleAudioFetch, type CallAudio, type MediaDeps } from '../src/handle-audio';
import { type AudioMessage, type TranscribeMessage } from '../src/messages';

function wav(seconds: number): Buffer {
  const sampleRate = 8000;
  const dataSize = Math.round(seconds * sampleRate) * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

function message(audio: AudioMessage['audio'], attempt = 1): AudioMessage {
  return {
    message_id: 'm1',
    project_id: 'p1',
    call_id: 'c1',
    attempt,
    enqueued_at: '2026-10-13T09:00:00.000Z',
    audio,
  };
}

function harness(call: CallAudio, options?: { min?: number; object?: Buffer | null; fetched?: MediaDeps['fetchUrl'] }) {
  const state = { ...call };
  const puts: string[] = [];
  const queued: TranscribeMessage[] = [];
  const durations: Array<number | null> = [];
  const statuses: string[] = [];
  let ids = 0;
  const deps: MediaDeps = {
    now: () => '2026-10-13T09:01:00.000Z',
    newId: () => `id-${(ids += 1)}`,
    bucket: 'recordings',
    loadCall: async () => ({ ...state }),
    loadMinDuration: async () => options?.min ?? 180,
    claim: async () => {
      state.processing_status = 'audio_fetch';
      return true;
    },
    saveObject: async (_projectId, _callId, key, contentType) => {
      state.recording_storage_key = key;
      state.recording_content_type = contentType;
    },
    saveDuration: async (_projectId, _callId, durationSec) => {
      state.duration_sec = durationSec;
      durations.push(durationSec);
    },
    finish: async (_projectId, _callId, status, fields) => {
      state.processing_status = status;
      if (fields.durationSec !== null) {
        state.duration_sec = fields.durationSec;
      }
      if (fields.key) {
        state.recording_storage_key = fields.key;
      }
      statuses.push(status);
    },
    fail: async (_projectId, _callId, error) => {
      state.processing_status = 'failed';
      statuses.push(`${error.message}:${error.attempts}`);
    },
    putObject: async (key) => {
      puts.push(key);
    },
    getObject: async (_bucket, key) => {
      if (options?.object === null || options?.object === undefined && !state.recording_storage_key && !key) {
        return null;
      }
      if (options && 'object' in options && options.object === null) {
        return null;
      }
      const body = options?.object ?? Buffer.from('stored');
      if (options?.object === undefined && call.recording_storage_key === null) {
        return null;
      }
      return { body, contentType: state.recording_content_type };
    },
    fetchUrl: options?.fetched ?? (async () => ({ ok: false, kind: 'retry' }) as const),
    enqueueTranscribe: async (queuedMessage) => {
      queued.push(queuedMessage);
    },
  };
  return { state, puts, queued, durations, statuses, deps };
}

describe('media pipeline', () => {
  it('publishes transcribe without downloading when the key and duration are already known', async () => {
    const fake = harness({
      processing_status: 'audio_queued',
      duration_sec: 200,
      recording_storage_key: 'projects/p1/calls/c1.mp3',
      recording_content_type: 'audio/mpeg',
    });
    let fetched = false;
    fake.deps.fetchUrl = async () => {
      fetched = true;
      return { ok: false, kind: 'missing' };
    };
    const result = await handleAudioFetch(
      message({ type: 'object', bucket: 'recordings', key: 'projects/p1/calls/c1.mp3', content_type: 'audio/mpeg' }),
      fake.deps,
    );
    assert.equal(result.action, 'ack');
    assert.equal(fetched, false);
    assert.equal(fake.queued.length, 1);
    assert.equal(fake.queued[0].attempt, 1);
    assert.deepEqual(fake.queued[0].audio, {
      bucket: 'recordings',
      key: 'projects/p1/calls/c1.mp3',
      content_type: 'audio/mpeg',
    });
    assert.deepEqual(fake.statuses, []);
  });

  it('does not copy an object that is already stored and skips a short file before speech', async () => {
    const fake = harness(
      {
        processing_status: 'audio_queued',
        duration_sec: null,
        recording_storage_key: 'projects/p1/calls/c1.wav',
        recording_content_type: 'audio/wav',
      },
      { object: wav(1), min: 180 },
    );
    const result = await handleAudioFetch(
      message({ type: 'object', bucket: 'recordings', key: 'projects/p1/calls/c1.wav', content_type: 'audio/wav' }),
      fake.deps,
    );
    assert.equal(result.action, 'ack');
    assert.deepEqual(fake.puts, []);
    assert.deepEqual(fake.queued, []);
    assert.deepEqual(fake.durations, []);
    assert.deepEqual(fake.statuses, ['skipped_short']);
    assert.equal(fake.state.processing_status, 'skipped_short');
    assert.equal(fake.state.duration_sec, 1);
  });

  it('does not publish speech when a retry already sees a stored short duration', async () => {
    const fake = harness(
      {
        processing_status: 'audio_fetch',
        duration_sec: 10,
        recording_storage_key: 'projects/p1/calls/c1.mp3',
        recording_content_type: 'audio/mpeg',
      },
      { min: 180 },
    );
    const result = await handleAudioFetch(
      message({ type: 'object', bucket: 'recordings', key: 'projects/p1/calls/c1.mp3', content_type: 'audio/mpeg' }),
      fake.deps,
    );
    assert.equal(result.action, 'ack');
    assert.deepEqual(fake.queued, []);
    assert.equal(fake.state.processing_status, 'skipped_short');
    assert.equal(fake.state.duration_sec, 10);
  });

  it('does not send a short call to speech when the status write fails', async () => {
    const fake = harness(
      {
        processing_status: 'audio_queued',
        duration_sec: null,
        recording_storage_key: 'projects/p1/calls/c1.wav',
        recording_content_type: 'audio/wav',
      },
      { object: wav(1), min: 180 },
    );
    const savedFinish = fake.deps.finish;
    fake.deps.finish = async () => {
      throw new Error('status write failed');
    };
    const first = await handleAudioFetch(
      message({ type: 'object', bucket: 'recordings', key: 'projects/p1/calls/c1.wav', content_type: 'audio/wav' }),
      fake.deps,
    );
    assert.equal(first.action, 'retry');
    assert.deepEqual(fake.queued, []);
    assert.equal(fake.state.duration_sec, null);

    fake.state.duration_sec = 1;
    fake.deps.finish = savedFinish;
    const second = await handleAudioFetch(
      message({ type: 'object', bucket: 'recordings', key: 'projects/p1/calls/c1.wav', content_type: 'audio/wav' }),
      fake.deps,
    );
    assert.equal(second.action, 'ack');
    assert.deepEqual(fake.queued, []);
    assert.equal(fake.state.processing_status, 'skipped_short');
  });

  it('marks skipped_no_duration when the file has no duration and does not enqueue speech', async () => {
    const fake = harness(
      {
        processing_status: 'audio_queued',
        duration_sec: null,
        recording_storage_key: 'projects/p1/calls/c1.bin',
        recording_content_type: 'application/octet-stream',
      },
      { object: Buffer.from('not-audio') },
    );
    await handleAudioFetch(
      message({ type: 'object', bucket: 'recordings', key: 'projects/p1/calls/c1.bin' }),
      fake.deps,
    );
    assert.equal(fake.state.processing_status, 'skipped_no_duration');
    assert.equal(fake.state.duration_sec, null);
    assert.deepEqual(fake.queued, []);
  });

  it('stores a downloaded url and does not reapply the threshold to a duration the api already accepted', async () => {
    const fake = harness(
      {
        processing_status: 'audio_queued',
        duration_sec: 200,
        recording_storage_key: null,
        recording_content_type: null,
      },
      { fetched: async () => ({ ok: true, body: wav(1), contentType: 'audio/wav' }) },
    );
    const result = await handleAudioFetch(message({ type: 'url', url: 'https://records.example/abc.wav' }), fake.deps);
    assert.equal(result.action, 'ack');
    assert.deepEqual(fake.puts, ['projects/p1/calls/c1.wav']);
    assert.equal(fake.state.duration_sec, 200);
    assert.equal(fake.durations.length, 0);
    assert.equal(fake.queued.length, 1);
    assert.equal(fake.state.recording_storage_key, 'projects/p1/calls/c1.wav');
  });

  it('enqueues speech when the file duration is not below the project threshold', async () => {
    const fake = harness(
      {
        processing_status: 'audio_queued',
        duration_sec: null,
        recording_storage_key: null,
        recording_content_type: null,
      },
      { min: 1, fetched: async () => ({ ok: true, body: wav(2), contentType: 'audio/wav' }) },
    );
    await handleAudioFetch(message({ type: 'url', url: 'https://records.example/long.wav' }), fake.deps);
    assert.equal(fake.state.duration_sec, 2);
    assert.equal(fake.queued.length, 1);
    assert.equal(fake.queued[0].audio.content_type, 'audio/wav');
  });

  it('marks recording_missing on 404 without a retry', async () => {
    const fake = harness(
      {
        processing_status: 'audio_queued',
        duration_sec: null,
        recording_storage_key: null,
        recording_content_type: null,
      },
      { fetched: async () => ({ ok: false, kind: 'missing' }) },
    );
    const result = await handleAudioFetch(message({ type: 'url', url: 'https://records.example/missing.mp3' }, 1), fake.deps);
    assert.equal(result.action, 'ack');
    assert.equal(fake.state.processing_status, 'recording_missing');
    assert.deepEqual(fake.queued, []);
  });

  it('retries network failures and fails the third attempt as audio_network_failure', async () => {
    const call: CallAudio = {
      processing_status: 'audio_queued',
      duration_sec: null,
      recording_storage_key: null,
      recording_content_type: null,
    };
    const first = harness(call, { fetched: async () => ({ ok: false, kind: 'retry' }) });
    const retry = await handleAudioFetch(message({ type: 'url', url: 'https://records.example/a.mp3' }, 1), first.deps);
    assert.equal(retry.action, 'retry');
    if (retry.action === 'retry') {
      assert.equal(retry.message.attempt, 2);
    }
    assert.equal(first.state.processing_status, 'audio_fetch');

    const third = harness(
      { ...call, processing_status: 'audio_fetch' },
      { fetched: async () => ({ ok: false, kind: 'retry' }) },
    );
    const failed = await handleAudioFetch(message({ type: 'url', url: 'https://records.example/a.mp3' }, 3), third.deps);
    assert.equal(failed.action, 'ack');
    assert.deepEqual(third.statuses, ['audio_network_failure:3']);
  });

  it('retries a missing object and then fails with audio_object_missing', async () => {
    const call: CallAudio = {
      processing_status: 'audio_fetch',
      duration_sec: null,
      recording_storage_key: 'projects/p1/calls/c1.mp3',
      recording_content_type: 'audio/mpeg',
    };
    const third = harness(call, { object: null });
    const result = await handleAudioFetch(
      message({ type: 'object', bucket: 'recordings', key: 'projects/p1/calls/c1.mp3' }, 3),
      third.deps,
    );
    assert.equal(result.action, 'ack');
    assert.deepEqual(third.statuses, ['audio_object_missing:3']);
    assert.deepEqual(third.queued, []);
  });

  it('does not reopen a call that already skipped', async () => {
    const fake = harness({
      processing_status: 'skipped_short',
      duration_sec: 1,
      recording_storage_key: 'projects/p1/calls/c1.wav',
      recording_content_type: 'audio/wav',
    });
    await handleAudioFetch(
      message({ type: 'object', bucket: 'recordings', key: 'projects/p1/calls/c1.wav' }),
      fake.deps,
    );
    assert.deepEqual(fake.queued, []);
    assert.equal(fake.state.processing_status, 'skipped_short');
  });
});
