import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { handleAnalyze, type AnalyzeDeps, type AnalysisState } from '../src/handle-analyze';
import { type AnalyzeMessage } from '../src/messages';
import { type StageInput } from '../src/score';

const stages: StageInput[] = [
  { key: 'opening', title: 'Открытие', weight: 0.15, instruction: 'Начало разговора и установление контакта' },
  { key: 'needs', title: 'Потребность', weight: 0.3, instruction: 'Выявление ситуации, проблемы и критериев выбора' },
  { key: 'presentation', title: 'Презентация', weight: 0.2, instruction: 'Конкретность предложения под сказанное клиентом' },
  { key: 'objections', title: 'Возражения', weight: 0.2, instruction: 'Работа с возражениями, включая стоимость' },
  { key: 'closing', title: 'Закрытие', weight: 0.15, instruction: 'Зафиксирован ли следующий шаг' },
];

const transcript = [
  { speaker: 'manager', start: 0, end: 1, text: 'Добрый день' },
  { speaker: 'client', start: 1, end: 2, text: 'Здравствуйте' },
];

function message(attempt = 1): AnalyzeMessage {
  return {
    message_id: 'm1',
    project_id: 'p1',
    call_id: 'c1',
    attempt,
    enqueued_at: '2026-10-13T09:00:00.000Z',
  };
}

function modelJson(): string {
  const body: Record<string, { score: number; comment: string }> = {};
  [85, 70, 68, 55, 60].forEach((score, index) => {
    body[stages[index].key] = { score, comment: `комментарий ${stages[index].key}` };
  });
  return JSON.stringify({ stages: body, summary: 'Клиент заинтересован.', overall: 1 });
}

function harness(state: AnalysisState, content: string | Error = modelJson()) {
  const requests: unknown[] = [];
  const saved: unknown[] = [];
  const completed: string[] = [];
  const failed: string[] = [];
  const deps: AnalyzeDeps = {
    now: () => '2026-10-13T09:06:00.000Z',
    newId: () => 'new-id',
    model: 'configured-model',
    load: async () => state,
    loadStages: async () => stages,
    loadScripts: async () => [{ title: 'Исходящий первый звонок', body: 'Представиться.' }],
    markAnalyzing: async () => undefined,
    save: async (_callId, score) => {
      saved.push(score);
      return true;
    },
    markCompleted: async () => {
      completed.push('completed');
    },
    fail: async (_projectId, _callId, error) => {
      failed.push(`${error.stage}:${error.message}:${error.attempts}`);
    },
    complete: async (input) => {
      requests.push(input);
      if (content instanceof Error) {
        throw content;
      }
      return { model: 'served-model', content };
    },
  };
  return { deps, requests, saved, completed, failed };
}

describe('analyzer pipeline', () => {
  it('scores the whole transcript, stores the served model, and computes the total', async () => {
    const fake = harness({ processing_status: 'transcribing', transcript, overall_score: null });
    const result = await handleAnalyze(message(), fake.deps);
    assert.equal(result.action, 'ack');
    const request = fake.requests[0] as {
      model: string;
      messages: Array<{ role: string; content: string }>;
    };
    assert.equal(request.model, 'configured-model');
    assert.equal(request.messages[0].role, 'system');
    const payload = JSON.parse(request.messages[1].content) as {
      scripts: unknown[];
      transcript: Array<{ speaker: string; text: string }>;
      stages: unknown[];
      phone?: string;
    };
    assert.deepEqual(Object.keys(payload).sort(), ['scripts', 'stages', 'transcript']);
    assert.deepEqual(
      payload.transcript.map((line) => line.text),
      ['Добрый день', 'Здравствуйте'],
    );
    assert.equal(payload.phone, undefined);
    const score = fake.saved[0] as { overall: number; model: string; summary: string; inputs: unknown[] };
    assert.equal(score.overall, 67);
    assert.equal(score.model, 'served-model');
    assert.equal(score.summary, 'Клиент заинтересован.');
    assert.deepEqual(score.inputs, [{ title: 'Исходящий первый звонок', body: 'Представиться.' }]);
    assert.deepEqual(fake.completed, ['completed']);
  });

  it('does not call the model when the total is already stored', async () => {
    const fake = harness({ processing_status: 'analyzing', transcript, overall_score: 67 });
    const result = await handleAnalyze(message(), fake.deps);
    assert.equal(result.action, 'ack');
    assert.deepEqual(fake.requests, []);
    assert.deepEqual(fake.saved, []);
    assert.deepEqual(fake.completed, ['completed']);
  });

  it('retries invalid json and a missing transcript, then fails without a partial score', async () => {
    const invalid = harness({ processing_status: 'transcribing', transcript, overall_score: null }, 'not-json');
    const retry = await handleAnalyze(message(1), invalid.deps);
    assert.equal(retry.action, 'retry');
    if (retry.action === 'retry') {
      assert.equal(retry.message.attempt, 2);
    }
    assert.deepEqual(invalid.saved, []);

    const third = harness({ processing_status: 'analyzing', transcript, overall_score: null }, '{"stages":{}}');
    const failed = await handleAnalyze(message(3), third.deps);
    assert.equal(failed.action, 'ack');
    assert.deepEqual(third.saved, []);
    assert.deepEqual(third.failed, ['analyze:invalid_model_json:3']);
    assert.deepEqual(third.completed, []);

    const missing = harness({ processing_status: 'transcribing', transcript: null, overall_score: null });
    const missingRetry = await handleAnalyze(message(2), missing.deps);
    assert.equal(missingRetry.action, 'retry');
    assert.deepEqual(missing.requests, []);

    const unavailable = harness(
      { processing_status: 'transcribing', transcript, overall_score: null },
      new Error('down'),
    );
    const down = await handleAnalyze(message(3), unavailable.deps);
    assert.equal(down.action, 'ack');
    assert.deepEqual(unavailable.failed, ['analyze:model_unavailable:3']);
    assert.deepEqual(unavailable.saved, []);
  });
});
