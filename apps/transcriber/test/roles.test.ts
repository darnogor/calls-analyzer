import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { replicasFromSpeech } from '../src/roles';

describe('speaker roles', () => {
  it('maps stereo channels left to manager and right to client', () => {
    const replicas = replicasFromSpeech(
      {
        channels: [
          { channel: 1, segments: [{ start: 1, end: 2, text: 'справа' }] },
          { channel: 0, segments: [{ start: 0, end: 1, text: 'слева' }] },
        ],
      },
      'in',
    );
    assert.deepEqual(replicas, [
      { speaker: 'manager', start: 0, end: 1, text: 'слева' },
      { speaker: 'client', start: 1, end: 2, text: 'справа' },
    ]);
  });

  it('keeps a single track and labels the first speaker from the call direction', () => {
    const body = {
      channels: [
        {
          segments: [
            { start: 3, end: 4, text: 'второй', speaker: 'b' },
            { start: 0, end: 1, text: 'первый', speaker: 'a' },
            { start: 5, end: 6, text: 'третий', speaker: 'c' },
            { start: 1.2, end: 1.1, text: 'битый', speaker: 'a' },
            { start: 1.5, end: 2, text: '   ', speaker: 'b' },
          ],
        },
      ],
    };
    assert.deepEqual(
      replicasFromSpeech(body, 'out').map((item) => item.speaker),
      ['manager', 'client', 'client'],
    );
    assert.equal(replicasFromSpeech(body, 'out')[0].text, 'первый');
    assert.deepEqual(
      replicasFromSpeech(body, 'in').map((item) => item.speaker),
      ['client', 'manager', 'client'],
    );
    assert.deepEqual(
      replicasFromSpeech({ segments: [{ start: 0, end: 1, text: 'алло', speaker: 'solo' }] }, null).map(
        (item) => item.speaker,
      ),
      ['manager'],
    );
    assert.deepEqual(
      replicasFromSpeech({ segments: [{ start: 0, end: 1, text: 'алло', speaker: 'solo' }] }, '').map(
        (item) => item.speaker,
      ),
      ['manager'],
    );
  });
});
