import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { coverageRatio, qualityScore } from '../../analyzer/src/score';
import { presentCall, type CallRow } from '../src/calls/present-call';
import {
  DEMO_CARD_KEY,
  DEMO_CLIENTS,
  DEMO_DEAL_STAGES,
  DEMO_MANAGERS,
  DEMO_PRODUCT_FACTS,
  DEMO_SCORING_PROMPT,
  DEMO_STAGES,
} from './pro-tehnik-fixture';

describe('PRO.Техник demo data', () => {
  it('loads the lists, the S1–S8 card, and the section 8 prompt', () => {
    assert.equal(DEMO_MANAGERS.length, 7);
    assert.equal(DEMO_MANAGERS[0], 'Александр Соколов');
    assert.equal(DEMO_MANAGERS[6], 'Сергей Лебедев');
    assert.equal(DEMO_CLIENTS.length, 20);
    assert.equal(DEMO_CLIENTS[0], 'Алексей Смирнов');
    assert.equal(DEMO_CLIENTS[19], 'Ксения Лазарева');
    assert.deepEqual(DEMO_DEAL_STAGES, [
      'Новая заявка',
      'Связываемся с клиентом',
      'Разбор назначен',
      'Разбор проведён',
      'Предложение отправлено',
      'Принимает решение',
      'Ожидаем оплату',
      'Успешно реализовано',
      'Закрыто и не реализовано',
    ]);
    assert.equal(DEMO_CARD_KEY, 'pro_tehnik_v1');
    assert.deepEqual(DEMO_STAGES.map((stage) => stage.weight), [5, 10, 10, 15, 10, 20, 15, 15]);
    assert.equal(DEMO_STAGES[3]?.sample_line, '');
    assert.equal(DEMO_SCORING_PROMPT.includes('not_applicable'), true);
    assert.equal(DEMO_SCORING_PROMPT.includes('unobservable'), true);
    assert.equal(DEMO_SCORING_PROMPT.includes('дословн'), true);
    assert.equal(DEMO_SCORING_PROMPT.includes('не утверждён'), true);
    assert.equal(DEMO_SCORING_PROMPT.includes('не not_applicable'), true);
    assert.equal(DEMO_PRODUCT_FACTS.includes('110 000'), true);
    assert.equal(
      qualityScore(DEMO_STAGES.map((stage, index) => ({
        status: 'scored',
        weight: stage.weight,
        score: [4, 3, 4, 3, 3, 4, 2, 4][index] ?? 0,
      }))),
      84,
    );
    assert.equal(
      qualityScore(DEMO_STAGES.map((stage) => ({ status: 'scored', weight: stage.weight, score: 4 }))),
      100,
    );
    assert.equal(
      coverageRatio([
        { status: 'scored', weight: 80 },
        { status: 'unobservable', weight: 20 },
        { status: 'not_applicable', weight: 15 },
      ]),
      0.8,
    );
  });
});

describe('call card snapshot', () => {
  it('keeps the scored stages and shows flags apart from the total', () => {
    const row = callRow({
      processing_status: 'completed',
      overall_score: 84,
      stages_json: [
        {
          key: 'S1',
          title: 'Контакт и роль',
          weight: 5,
          high_score: 'Роль ясна',
          status: 'scored',
          score: 4,
          reason: 'Роль названа',
          evidence_ids: ['t1'],
        },
        {
          key: 'S2',
          title: 'Ситуация',
          weight: 10,
          status: 'not_applicable',
          score: null,
          reason: 'Не этот разговор',
          evidence_ids: [],
        },
      ],
      extras_json: {
        coverage: 1,
        preliminary: false,
        flags: [{ code: 'false_role', evidence_ids: ['t1'] }],
        payment_agreement: { agreed: false, summary: null, evidence_ids: [] },
      },
    });
    const card = presentCall(row);
    const stages = card.stages as Array<{ key: string; score: number | null; status: string }>;
    assert.equal(stages[0]?.score, 4);
    assert.equal(stages[1]?.status, 'not_applicable');
    assert.equal(stages[1]?.score, null);
    assert.equal(card.overall_score, 84);
    assert.deepEqual(card.flags, [{ code: 'false_role', evidence_ids: ['t1'] }]);
    assert.equal((card.payment_agreement as { agreed: boolean }).agreed, false);
  });
});

function callRow(overrides: Partial<CallRow>): CallRow {
  return {
    id: 'c1',
    started_at: '2026-10-13T09:00:00.000Z',
    duration_sec: 600,
    direction: 'out',
    phone: null,
    company_name: null,
    deal_name: null,
    deal_link_status: 'absent',
    deal_status_at_call_name: null,
    current_deal_status_name: null,
    deal_external_url: null,
    processing_status: 'completed',
    error: null,
    context_json: { notes: null, fields: [] },
    recording_storage_key: null,
    source_kind: 'manual',
    source_provider: null,
    source_display_name: 'Ручная загрузка',
    manager_id: null,
    manager_name: null,
    contact_id: null,
    contact_name: null,
    contact_external_url: null,
    stages_json: null,
    overall_score: null,
    summary: null,
    extras_json: null,
    transcript_json: null,
    ...overrides,
  };
}
