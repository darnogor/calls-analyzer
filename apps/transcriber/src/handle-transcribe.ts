import { nextAttempt, stageError } from './attempts';
import { type AnalyzeMessage, type TranscribeMessage } from './messages';
import { replicasFromSpeech, type Replica } from './roles';
import { SpeechTransportError } from './speech';
import { assignUtteranceIds } from './utterances';

const STOP = new Set(['completed', 'failed', 'skipped_short', 'skipped_no_duration', 'recording_missing']);

export type HandleResult = { action: 'ack' } | { action: 'retry'; message: TranscribeMessage };

export type TranscribeDeps = {
  now: () => string;
  newId: () => string;
  loadCall: (
    projectId: string,
    callId: string,
  ) => Promise<{ processing_status: string; direction: string | null } | null>;
  loadTranscript: (callId: string) => Promise<Replica[] | null>;
  markTranscribing: (projectId: string, callId: string) => Promise<void>;
  ensureAnalysis: (callId: string) => Promise<void>;
  getObject: (bucket: string, key: string) => Promise<{ body: Buffer; contentType: string | null } | null>;
  recognize: (input: { bytes: Buffer; filename: string; contentType: string }) => Promise<unknown>;
  saveTranscript: (callId: string, replicas: Replica[]) => Promise<void>;
  enqueueAnalyze: (message: AnalyzeMessage) => Promise<void>;
  fail: (projectId: string, callId: string, error: ReturnType<typeof stageError>) => Promise<void>;
};

export async function handleTranscribe(message: TranscribeMessage, deps: TranscribeDeps): Promise<HandleResult> {
  const call = await deps.loadCall(message.project_id, message.call_id);
  if (!call || STOP.has(call.processing_status)) {
    return { action: 'ack' };
  }
  const existing = await deps.loadTranscript(message.call_id);
  if (existing && existing.length > 0) {
    await publish(message, deps);
    return { action: 'ack' };
  }
  if (call.processing_status === 'analyzing') {
    return { action: 'ack' };
  }
  try {
    await deps.markTranscribing(message.project_id, message.call_id);
    await deps.ensureAnalysis(message.call_id);
    const again = await deps.loadTranscript(message.call_id);
    if (again && again.length > 0) {
      await publish(message, deps);
      return { action: 'ack' };
    }
    const object = await deps.getObject(message.audio.bucket, message.audio.key);
    if (!object) {
      return retryOrFail(message, deps, 'audio_object_missing');
    }
    const filename = message.audio.key.split('/').pop() || 'audio.bin';
    let body: unknown;
    try {
      body = await deps.recognize({
        bytes: object.body,
        filename,
        contentType: object.contentType || message.audio.content_type,
      });
    } catch (error) {
      if (!(error instanceof SpeechTransportError)) {
        console.error('transcribe', message.call_id, error);
      }
      return retryOrFail(message, deps, 'provider_unavailable');
    }
    const replicas = assignUtteranceIds(replicasFromSpeech(body, call.direction));
    if (replicas.length === 0) {
      return retryOrFail(message, deps, 'empty_transcript');
    }
    await deps.saveTranscript(message.call_id, replicas);
    await publish(message, deps);
    return { action: 'ack' };
  } catch (error) {
    console.error('transcribe', message.call_id, error);
    return retryOrFail(message, deps, 'provider_unavailable');
  }
}

async function publish(message: TranscribeMessage, deps: TranscribeDeps): Promise<void> {
  await deps.enqueueAnalyze({
    message_id: deps.newId(),
    project_id: message.project_id,
    call_id: message.call_id,
    attempt: 1,
    enqueued_at: deps.now(),
  });
}

async function retryOrFail(message: TranscribeMessage, deps: TranscribeDeps, code: string): Promise<HandleResult> {
  const retry = nextAttempt(message, deps.now(), deps.newId());
  if (retry) {
    return { action: 'retry', message: retry };
  }
  await deps.fail(
    message.project_id,
    message.call_id,
    stageError('transcribe', code, message.attempt, deps.now()),
  );
  return { action: 'ack' };
}
