import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { overallScore, parseModelJson, type StageInput } from '../src/score';

const stages: StageInput[] = [
  { key: 'opening', title: 'Открытие', weight: 0.15, instruction: 'Начало разговора и установление контакта' },
  { key: 'needs', title: 'Потребность', weight: 0.3, instruction: 'Выявление ситуации, проблемы и критериев выбора' },
  { key: 'presentation', title: 'Презентация', weight: 0.2, instruction: 'Конкретность предложения под сказанное клиентом' },
  { key: 'objections', title: 'Возражения', weight: 0.2, instruction: 'Работа с возражениями, включая стоимость' },
  { key: 'closing', title: 'Закрытие', weight: 0.15, instruction: 'Зафиксирован ли следующий шаг' },
];

function payload(scores: number[]): string {
  const body: Record<string, { score: number; comment: string }> = {};
  stages.forEach((stage, index) => {
    body[stage.key] = { score: scores[index], comment: `комментарий ${stage.key}` };
  });
  return JSON.stringify({ stages: body, summary: 'Клиент заинтересован.', overall: 1 });
}

describe('overall score', () => {
  it('rounds the weighted sum in the service', () => {
    assert.equal(
      overallScore([
        { score: 85, weight: 0.15 },
        { score: 70, weight: 0.3 },
        { score: 68, weight: 0.2 },
        { score: 55, weight: 0.2 },
        { score: 60, weight: 0.15 },
      ]),
      67,
    );
  });
});

describe('model json', () => {
  it('accepts an exact stage set and ignores a model total', () => {
    const parsed = parseModelJson(payload([85, 70, 68, 55, 60]), stages);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) {
      return;
    }
    assert.equal(parsed.summary, 'Клиент заинтересован.');
    assert.equal(parsed.stages[0].instruction, stages[0].instruction);
    assert.equal(parsed.stages[0].weight, 0.15);
    assert.equal(overallScore(parsed.stages), 67);
  });

  it('rejects text that is not json, a different key set, an empty summary, and a score outside 0-100', () => {
    assert.equal(parseModelJson('ответ {"stages":{}}', stages).ok, false);
    assert.equal(parseModelJson('{"stages":{"opening":{"score":1,"comment":"x"}},"summary":"s"}', stages).ok, false);
    const missingSummary = JSON.parse(payload([85, 70, 68, 55, 60])) as { summary: string };
    missingSummary.summary = '   ';
    assert.equal(parseModelJson(JSON.stringify(missingSummary), stages).ok, false);
    assert.equal(parseModelJson(payload([85, 70, 68, 55, 101]), stages).ok, false);
    assert.equal(parseModelJson(payload([85.5, 70, 68, 55, 60]), stages).ok, false);
  });
});
