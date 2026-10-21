import { objectExtension } from './audio-name';
import { nextAttempt, stageError } from './attempts';
import { readAudioDuration, wholeSeconds } from './duration';
import { type FetchAudioResult } from './fetch-audio';
import { type AudioMessage, type TranscribeMessage } from './messages';

const ACTIVE = new Set(['audio_queued', 'audio_fetch', 'recording_pending']);
const DONE = new Set([
  'skipped_short',
  'skipped_no_duration',
  'recording_missing',
  'failed',
  'completed',
  'transcribing',
  'analyzing',
]);

export type CallAudio = {
  processing_status: string;
  duration_sec: number | null;
  recording_storage_key: string | null;
  recording_content_type: string | null;
};

export type StoredObject = {
  body: Buffer;
  contentType: string | null;
};

export type HandleResult = { action: 'ack' } | { action: 'retry'; message: AudioMessage };

export type MediaDeps = {
  now: () => string;
  newId: () => string;
  bucket: string;
  loadCall: (projectId: string, callId: string) => Promise<CallAudio | null>;
  loadMinDuration: (projectId: string) => Promise<number | null>;
  claim: (projectId: string, callId: string) => Promise<boolean>;
  saveObject: (projectId: string, callId: string, key: string, contentType: string) => Promise<void>;
  saveDuration: (projectId: string, callId: string, durationSec: number) => Promise<void>;
  finish: (
    projectId: string,
    callId: string,
    status: 'skipped_short' | 'skipped_no_duration' | 'recording_missing',
    fields: { durationSec: number | null; key: string | null; contentType: string | null },
  ) => Promise<void>;
  fail: (projectId: string, callId: string, error: ReturnType<typeof stageError>) => Promise<void>;
  putObject: (key: string, body: Buffer, contentType: string) => Promise<void>;
  getObject: (bucket: string, key: string) => Promise<StoredObject | null>;
  fetchUrl: (url: string) => Promise<FetchAudioResult>;
  enqueueTranscribe: (message: TranscribeMessage) => Promise<void>;
};

export async function handleAudioFetch(message: AudioMessage, deps: MediaDeps): Promise<HandleResult> {
  const call = await deps.loadCall(message.project_id, message.call_id);
  if (!call || DONE.has(call.processing_status) || !ACTIVE.has(call.processing_status)) {
    return { action: 'ack' };
  }
  const claimed = await deps.claim(message.project_id, message.call_id);
  if (!claimed) {
    const again = await deps.loadCall(message.project_id, message.call_id);
    if (!again || DONE.has(again.processing_status) || !ACTIVE.has(again.processing_status)) {
      return { action: 'ack' };
    }
  }
  const current = (await deps.loadCall(message.project_id, message.call_id)) ?? call;
  if (DONE.has(current.processing_status)) {
    return { action: 'ack' };
  }
  try {
    return await processAudio(message, current, deps);
  } catch (error) {
    console.error('audio fetch', message.call_id, error);
    return retryOrFail(message, deps, 'audio_network_failure');
  }
}

async function processAudio(message: AudioMessage, call: CallAudio, deps: MediaDeps): Promise<HandleResult> {
  const minDuration = await deps.loadMinDuration(message.project_id);
  if (minDuration === null) {
    return retryOrFail(message, deps, 'audio_network_failure');
  }

  let key = call.recording_storage_key;
  let contentType = call.recording_content_type;
  const hadDuration = call.duration_sec !== null && call.duration_sec !== undefined;
  let duration = call.duration_sec;

  if (key && hadDuration) {
    await deps.enqueueTranscribe(transcribeMessage(message, deps, key, contentType || 'application/octet-stream'));
    return { action: 'ack' };
  }

  let bytes: Buffer | null = null;
  if (!key) {
    if (message.audio.type === 'object') {
      const object = await deps.getObject(message.audio.bucket, message.audio.key);
      if (!object) {
        return retryOrFail(message, deps, 'audio_object_missing');
      }
      key = message.audio.key;
      contentType = contentType || message.audio.content_type || object.contentType || 'application/octet-stream';
      bytes = object.body;
      await deps.saveObject(message.project_id, message.call_id, key, contentType);
    } else {
      const fetched = await deps.fetchUrl(message.audio.url);
      if (!fetched.ok) {
        if (fetched.kind === 'missing') {
          await deps.finish(message.project_id, message.call_id, 'recording_missing', {
            durationSec: duration,
            key: null,
            contentType: null,
          });
          return { action: 'ack' };
        }
        return retryOrFail(message, deps, 'audio_network_failure');
      }
      const named = objectExtension(fetched.contentType, message.audio.url);
      key = `projects/${message.project_id}/calls/${message.call_id}.${named.ext}`;
      contentType = named.contentType;
      await deps.putObject(key, fetched.body, contentType);
      await deps.saveObject(message.project_id, message.call_id, key, contentType);
      bytes = fetched.body;
    }
  } else if (!hadDuration) {
    const bucket = message.audio.type === 'object' ? message.audio.bucket : deps.bucket;
    const object = await deps.getObject(bucket, key);
    if (!object) {
      return retryOrFail(message, deps, 'audio_object_missing');
    }
    bytes = object.body;
    contentType = contentType || object.contentType || 'application/octet-stream';
  }

  if (!hadDuration) {
    if (!bytes || !key) {
      return retryOrFail(message, deps, 'audio_object_missing');
    }
    const read = readAudioDuration(bytes);
    const whole = read ? wholeSeconds(read.seconds) : null;
    if (whole === null) {
      await deps.finish(message.project_id, message.call_id, 'skipped_no_duration', {
        durationSec: null,
        key,
        contentType,
      });
      return { action: 'ack' };
    }
    duration = whole;
    await deps.saveDuration(message.project_id, message.call_id, whole);
    if (whole < minDuration) {
      await deps.finish(message.project_id, message.call_id, 'skipped_short', {
        durationSec: whole,
        key,
        contentType,
      });
      return { action: 'ack' };
    }
  }

  if (!key) {
    return retryOrFail(message, deps, 'audio_object_missing');
  }
  await deps.enqueueTranscribe(
    transcribeMessage(message, deps, key, contentType || 'application/octet-stream'),
  );
  return { action: 'ack' };
}

function transcribeMessage(
  message: AudioMessage,
  deps: MediaDeps,
  key: string,
  contentType: string,
): TranscribeMessage {
  const bucket = message.audio.type === 'object' ? message.audio.bucket : deps.bucket;
  return {
    message_id: deps.newId(),
    project_id: message.project_id,
    call_id: message.call_id,
    attempt: 1,
    enqueued_at: deps.now(),
    audio: { bucket, key, content_type: contentType },
  };
}

async function retryOrFail(message: AudioMessage, deps: MediaDeps, code: string): Promise<HandleResult> {
  const retry = nextAttempt(message, deps.now(), deps.newId());
  if (retry) {
    return { action: 'retry', message: retry };
  }
  await deps.fail(message.project_id, message.call_id, stageError('audio', code, message.attempt, deps.now()));
  return { action: 'ack' };
}
