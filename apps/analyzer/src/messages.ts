export const ANALYZE_QUEUE = 'calls.analyze';

export type AnalyzeMessage = {
  message_id: string;
  project_id: string;
  call_id: string;
  attempt: number;
  enqueued_at: string;
};

export function parseAnalyzeMessage(raw: string): AnalyzeMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Partial<AnalyzeMessage>;
  if (!record.project_id || !record.call_id) {
    return null;
  }
  return {
    message_id: typeof record.message_id === 'string' ? record.message_id : '',
    project_id: record.project_id,
    call_id: record.call_id,
    attempt: Number.isInteger(record.attempt) && (record.attempt as number) > 0 ? (record.attempt as number) : 1,
    enqueued_at: typeof record.enqueued_at === 'string' ? record.enqueued_at : new Date().toISOString(),
  };
}
