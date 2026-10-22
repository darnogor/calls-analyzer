export const AUDIO_FETCH_QUEUE = 'calls.audio.fetch';
export const TRANSCRIBE_QUEUE = 'calls.transcribe';
export const ANALYZE_QUEUE = 'calls.analyze';

export type AudioMessage = {
  message_id: string;
  project_id: string;
  call_id: string;
  attempt: number;
  enqueued_at: string;
  audio:
    | { type: 'url'; url: string }
    | { type: 'object'; bucket: string; key: string; content_type?: string };
};

export type TranscribeMessage = {
  message_id: string;
  project_id: string;
  call_id: string;
  attempt: number;
  enqueued_at: string;
  audio: {
    bucket: string;
    key: string;
    content_type: string;
  };
};

export type AnalyzeMessage = {
  message_id: string;
  project_id: string;
  call_id: string;
  attempt: number;
  enqueued_at: string;
};

export function parseAudioMessage(raw: string): AudioMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Partial<AudioMessage>;
  if (!record.project_id || !record.call_id || !record.audio || typeof record.audio !== 'object') {
    return null;
  }
  const audio = record.audio;
  if (audio.type === 'url' && typeof audio.url === 'string' && audio.url) {
    return {
      message_id: typeof record.message_id === 'string' ? record.message_id : '',
      project_id: record.project_id,
      call_id: record.call_id,
      attempt: Number.isInteger(record.attempt) && (record.attempt as number) > 0 ? (record.attempt as number) : 1,
      enqueued_at: typeof record.enqueued_at === 'string' ? record.enqueued_at : new Date().toISOString(),
      audio: { type: 'url', url: audio.url },
    };
  }
  if (audio.type === 'object' && typeof audio.bucket === 'string' && typeof audio.key === 'string') {
    return {
      message_id: typeof record.message_id === 'string' ? record.message_id : '',
      project_id: record.project_id,
      call_id: record.call_id,
      attempt: Number.isInteger(record.attempt) && (record.attempt as number) > 0 ? (record.attempt as number) : 1,
      enqueued_at: typeof record.enqueued_at === 'string' ? record.enqueued_at : new Date().toISOString(),
      audio: {
        type: 'object',
        bucket: audio.bucket,
        key: audio.key,
        content_type: typeof audio.content_type === 'string' ? audio.content_type : undefined,
      },
    };
  }
  return null;
}
