export const MAX_ATTEMPTS = 3;

export type StageError = {
  stage: 'audio' | 'transcribe' | 'analyze';
  message: string;
  attempts: number;
  failed_at: string;
};

export function stageError(
  stage: StageError['stage'],
  message: string,
  attempt: number,
  now: string,
): StageError {
  const current = Number.isInteger(attempt) && attempt > 0 ? attempt : 1;
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
  const attempt = Number.isInteger(message.attempt) && message.attempt > 0 ? message.attempt : 1;
  if (attempt >= MAX_ATTEMPTS) {
    return null;
  }
  return { ...message, attempt: attempt + 1, message_id: messageId, enqueued_at: now };
}
