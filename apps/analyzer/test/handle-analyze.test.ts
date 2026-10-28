import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { handleAnalyze, type AnalyzeDeps, type AnalysisState, type ScorecardInput } from '../src/handle-analyze';
import { type AnalyzeMessage } from '../src/messages';
import { SYSTEM_PROMPT } from '../src/prompt';

const scorecard: ScorecardInput = {
  cardKey: 'pro_tehnik_v1',
  stages: [
    { key: 'S1', title: 'Контакт', weight: 5, high_score: 'роль ясна', defect_example: 'нет роли', sample_line: 'добрый день' },
    { key: 'S2', title: 'Ситуация', weight: 10, high_score: 'данные есть', defect_example: '', sample_line: '' },
  ],
};

const transcript = [
  { id: 't1', speaker: 'manager', start: 0, end: 1, text: 'Добрый день' },
  { id: 't2', speaker: 'client', start: 1, end: 2, text: 'Здравствуйте' },
];

const prompt = 'Не требуй дословности. Пропущенный этап — это низкий балл, не not_applicable.';

function message(attempt = 1): AnalyzeMessage {
  return {
    message_id: 'm1',
    project_id: 'p1',
    call_id: 'c1',
    attempt,
    enqueued_at: '2026-10-13T09:00:00.000Z',
  };
}

function modelJson(overall = 15): string {
  return JSON.stringify({
    stages: [
      { key: 'S1', status: 'scored', score: 4, reason: 'Роль названа', evidence_ids: ['t1'] },
      { key: 'S2', status: 'scored', score: 2, reason: 'Ситуацию не собрал', evidence_ids: ['t2'] },
    ],
    flags: [{ code: 'false_role', evidence_ids: ['t1'] }],
    payment_agreement: { agreed: null, summary: null, evidence_ids: [] },
    summary: 'Клиент думает',
    quality_score: overall,
  });
}

function state(overrides: Partial<AnalysisState> = {}): AnalysisState {
  return {
    processing_status: 'transcribing',
    transcript,
    overall_score: null,
    analyzed: false,
    manager: { name: 'Анна Морозова' },
    client: { name: 'Алексей Смирнов', company: null },
    ...overrides,
  };
}

function harness(current: AnalysisState, content: string | Error = modelJson()) {
  const requests: unknown[] = [];
  const saved: unknown[] = [];
  const completed: string[] = [];
  const failed: string[] = [];
  const deps: AnalyzeDeps = {
    now: () => '2026-10-13T09:06:00.000Z',
    newId: () => 'new-id',
    model: 'configured-model',
    load: async () => current,
    loadScorecard: async () => scorecard,
    loadPrompt: async () => prompt,
    loadFacts: async () => 'Стоимость начинается от 110 000 ₽.',
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
  it('sends the scorecard and prompt as data and computes the total', async () => {
    const fake = harness(state());
    const result = await handleAnalyze(message(), fake.deps);
    assert.equal(result.action, 'ack');
    const request = fake.requests[0] as {
      messages: Array<{ role: string; content: string }>;
    };
    assert.equal(request.messages[0]?.content, SYSTEM_PROMPT);
    assert.equal(request.messages[0]?.content.includes(prompt), false);
    const payload = JSON.parse(request.messages[1]?.content ?? '') as {
      scorecard: { key: string; stages: unknown[] };
      prompt: string;
      product_facts: string;
      manager: { name: string };
      client: { name: string };
      transcript: Array<{ id: string; text: string }>;
      scripts?: unknown;
      phone?: string;
    };
    assert.equal(payload.scorecard.key, 'pro_tehnik_v1');
    assert.equal(payload.prompt, prompt);
    assert.equal(payload.product_facts.includes('110 000'), true);
    assert.equal(payload.manager.name, 'Анна Морозова');
    assert.equal(payload.client.name, 'Алексей Смирнов');
    assert.deepEqual(payload.transcript.map((line) => line.id), ['t1', 't2']);
    assert.equal(payload.scripts, undefined);
    assert.equal(payload.phone, undefined);
    const score = fake.saved[0] as {
      overall: number;
      summary: string | null;
      extras: { flags: unknown[]; payment_agreement: { agreed: boolean | null } };
      inputs: { scoring_prompt: string };
    };
    assert.equal(score.overall, 67);
    assert.equal(score.summary, 'Клиент думает');
    assert.equal(score.extras.flags.length, 1);
    assert.equal(score.extras.payment_agreement.agreed, null);
    assert.equal(score.inputs.scoring_prompt, prompt);
    assert.deepEqual(fake.completed, ['completed']);
  });

  it('does not call the model when the call is already scored', async () => {
    const fake = harness(state({ processing_status: 'analyzing', analyzed: true, overall_score: null }));
    const result = await handleAnalyze(message(), fake.deps);
    assert.equal(result.action, 'ack');
    assert.deepEqual(fake.requests, []);
    assert.deepEqual(fake.saved, []);
    assert.deepEqual(fake.completed, ['completed']);
  });

  it('retries invalid json and a missing transcript, then fails without a partial score', async () => {
    const invalid = harness(state(), 'not-json');
    const retry = await handleAnalyze(message(1), invalid.deps);
    assert.equal(retry.action, 'retry');
    if (retry.action === 'retry') {
      assert.equal(retry.message.attempt, 2);
    }
    assert.deepEqual(invalid.saved, []);

    const third = harness(state({ processing_status: 'analyzing' }), '{"stages":[]}');
    const failed = await handleAnalyze(message(3), third.deps);
    assert.equal(failed.action, 'ack');
    assert.deepEqual(third.saved, []);
    assert.deepEqual(third.failed, ['analyze:invalid_model_json:3']);

    const missing = harness(state({ transcript: null }));
    const missingRetry = await handleAnalyze(message(2), missing.deps);
    assert.equal(missingRetry.action, 'retry');
    assert.deepEqual(missing.requests, []);

    const unavailable = harness(state(), new Error('down'));
    const down = await handleAnalyze(message(3), unavailable.deps);
    assert.equal(down.action, 'ack');
    assert.deepEqual(unavailable.failed, ['analyze:model_unavailable:3']);
    assert.deepEqual(unavailable.saved, []);
  });
});
