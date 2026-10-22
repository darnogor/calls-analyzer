import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { objectExtension } from '../src/audio-name';
import { fetchAudio } from '../src/fetch-audio';

function response(status: number, body: string | Buffer, contentType?: string): Response {
  const bytes = typeof body === 'string' ? Buffer.from(body) : body;
  return new Response(bytes, {
    status,
    headers: contentType ? { 'content-type': contentType } : undefined,
  });
}

describe('object name', () => {
  it('takes the extension from the content type, then the url, otherwise bin', () => {
    assert.deepEqual(objectExtension('audio/mpeg', 'https://records.example/a.wav'), {
      ext: 'mp3',
      contentType: 'audio/mpeg',
    });
    assert.deepEqual(objectExtension(null, 'https://records.example/path/a.ogg?x=1'), {
      ext: 'ogg',
      contentType: 'audio/ogg',
    });
    assert.deepEqual(objectExtension('text/plain', 'https://records.example/a'), {
      ext: 'bin',
      contentType: 'text/plain',
    });
  });
});

describe('fetch audio', () => {
  it('treats 404 and 410 as a missing recording and empty or failed responses as retries', async () => {
    assert.deepEqual(await fetchAudio('https://records.example/a', 1000, async () => response(404, 'no')), {
      ok: false,
      kind: 'missing',
    });
    assert.deepEqual(await fetchAudio('https://records.example/a', 1000, async () => response(410, 'gone')), {
      ok: false,
      kind: 'missing',
    });
    for (const status of [408, 429, 500, 503]) {
      assert.deepEqual(await fetchAudio('https://records.example/a', 1000, async () => response(status, 'x')), {
        ok: false,
        kind: 'retry',
      });
    }
    assert.deepEqual(await fetchAudio('https://records.example/a', 1000, async () => response(200, '')), {
      ok: false,
      kind: 'retry',
    });
    assert.deepEqual(
      await fetchAudio('https://records.example/a', 1000, async () => {
        throw new Error('timeout');
      }),
      { ok: false, kind: 'retry' },
    );
    const ok = await fetchAudio(
      'https://records.example/a.mp3',
      1000,
      async () => response(200, Buffer.from('audio'), 'audio/mpeg'),
    );
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.equal(ok.contentType, 'audio/mpeg');
      assert.equal(ok.body.toString(), 'audio');
    }
  });
});
