import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { coverageRatio, parseModelJson, qualityScore, type StageInput } from '../src/score';

const stages: StageInput[] = [
  { key: 'S1', title: 'Контакт', weight: 5, high_score: 'роль ясна', defect_example: 'нет роли', sample_line: 'добрый день' },
  { key: 'S2', title: 'Ситуация', weight: 10, high_score: 'данные есть', defect_example: 'нет техники', sample_line: '' },
];

const ids = new Set(['t1', 't2']);

function model(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    stages: [
      { key: 'S1', status: 'scored', score: 4, reason: 'Роль названа', evidence_ids: ['t1'] },
      { key: 'S2', status: 'not_applicable', score: null, reason: 'Разбор не про это', evidence_ids: [] },
    ],
    flags: [],
    payment_agreement: { agreed: false, summary: null, evidence_ids: [] },
    quality_score: 1,
    ...overrides,
  });
}

describe('quality score', () => {
  it('uses only scored stages and ignores a model total', () => {
    assert.equal(
      qualityScore([
        { status: 'scored', score: 4, weight: 5 },
        { status: 'scored', score: 3, weight: 10 },
        { status: 'scored', score: 4, weight: 10 },
        { status: 'scored', score: 3, weight: 15 },
        { status: 'scored', score: 3, weight: 10 },
        { status: 'scored', score: 4, weight: 20 },
        { status: 'scored', score: 2, weight: 15 },
        { status: 'scored', score: 4, weight: 15 },
      ]),
      84,
    );
    assert.equal(
      qualityScore([
        { status: 'scored', score: 4, weight: 5 },
        { status: 'not_applicable', score: null, weight: 10 },
        { status: 'unobservable', score: null, weight: 20 },
      ]),
      100,
    );
    assert.equal(qualityScore([{ status: 'not_applicable', score: null, weight: 10 }]), null);
  });

  it('counts unobservable in coverage and leaves not applicable out', () => {
    assert.equal(
      coverageRatio([
        { status: 'scored', weight: 5 },
        { status: 'unobservable', weight: 15 },
        { status: 'not_applicable', weight: 20 },
      ]),
      0.25,
    );
    assert.equal(coverageRatio([{ status: 'not_applicable', weight: 10 }]), null);
    assert.equal(
      coverageRatio([
        { status: 'scored', weight: 5 },
        { status: 'scored', weight: 10 },
      ]),
      1,
    );
  });
});

describe('model json', () => {
  it('accepts the scorecard keys and keeps flags off the score', () => {
    const parsed = parseModelJson(model(), stages, ids);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.value.stages[0]?.score, 4);
    assert.equal(parsed.value.stages[1]?.score, null);
    assert.equal(parsed.value.stages[0]?.high_score, 'роль ясна');
    assert.equal(parsed.value.summary, null);
    const withSummary = parseModelJson(model({ summary: ' Клиент думает ' }), stages, ids);
    assert.equal(withSummary.ok, true);
    if (!withSummary.ok) return;
    assert.equal(withSummary.value.summary, 'Клиент думает');
    const withFlag = parseModelJson(
      model({ flags: [{ code: 'false_role', evidence_ids: ['t2'] }] }),
      stages,
      ids,
    );
    assert.equal(withFlag.ok, true);
    if (!withFlag.ok) return;
    assert.equal(qualityScore(parsed.value.stages), qualityScore(withFlag.value.stages));
    assert.equal(qualityScore(parsed.value.stages), 100);
  });

  it('rejects a bad status, a score on an excluded stage, a missing turn, and a flag without evidence', () => {
    assert.equal(parseModelJson('не json', stages, ids).ok, false);
    const badStatus = JSON.parse(model()) as { stages: Array<{ status: string }> };
    badStatus.stages[0]!.status = 'skipped';
    assert.equal(parseModelJson(JSON.stringify(badStatus), stages, ids).ok, false);
    const scoredNull = JSON.parse(model()) as { stages: Array<{ score: number | null }> };
    scoredNull.stages[1]!.score = 0;
    assert.equal(parseModelJson(JSON.stringify(scoredNull), stages, ids).ok, false);
    const missingTurn = JSON.parse(model()) as { stages: Array<{ evidence_ids: string[] }> };
    missingTurn.stages[0]!.evidence_ids = ['t9'];
    assert.equal(parseModelJson(JSON.stringify(missingTurn), stages, ids).ok, false);
    assert.equal(
      parseModelJson(model({ flags: [{ code: 'pressure', evidence_ids: [] }] }), stages, ids).ok,
      false,
    );
    assert.equal(
      parseModelJson(model({ payment_agreement: { agreed: true, summary: 'завтра', evidence_ids: [] } }), stages, ids).ok,
      false,
    );
  });
});
