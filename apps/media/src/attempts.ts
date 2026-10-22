export const MAX_ATTEMPTS = 3;

export type StageName = 'audio' | 'transcribe' | 'analyze';

export type StageError = {
  stage: StageName;
  message: string;
  attempts: number;
  failed_at: string;
};

export function stageError(stage: StageName, message: string, attempt: number, now: string): StageError {
  const current = normalizeAttempt(attempt);
  return {
    stage,
    message,
    attempts: current >= MAX_ATTEMPTS ? current : MAX_ATTEMPTS,
    failed_at: now,
  };
}

export function nextAttempt<T extends { attempt: number; message_id: string; enqueued_at: string }>(
  message: T,
  now: string,
  messageId: string,
): T | null {
  const attempt = normalizeAttempt(message.attempt);
  if (attempt >= MAX_ATTEMPTS) {
    return null;
  }
  return {
    ...message,
    attempt: attempt + 1,
    message_id: messageId,
    enqueued_at: now,
  };
}

function normalizeAttempt(attempt: number): number {
  return Number.isInteger(attempt) && attempt > 0 ? attempt : 1;
}
