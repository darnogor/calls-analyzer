import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { requestTranscript, SpeechTransportError, speechEndpoint } from '../src/speech';

describe('speech endpoint', () => {
  it('uses the configured url and does not branch on a provider name', () => {
    assert.deepEqual(speechEndpoint({ STT_PROVIDER: 'http://speech.test/v1' }), {
      url: 'http://speech.test/v1',
      provider: null,
    });
    assert.deepEqual(speechEndpoint({ STT_API_URL: 'http://speech.test/v1', STT_PROVIDER: 'configured' }), {
      url: 'http://speech.test/v1',
      provider: 'configured',
    });
    assert.equal(speechEndpoint({ STT_PROVIDER: 'configured' }), null);
    assert.equal(speechEndpoint({}), null);
  });
});

describe('speech request', () => {
  it('posts russian audio and returns the response json', async () => {
    let seenUrl = '';
    const body = await requestTranscript({
      url: 'http://speech.test/v1',
      apiKey: 'secret',
      provider: 'configured',
      timeoutMs: 1000,
      bytes: Buffer.from('audio'),
      filename: 'call.wav',
      contentType: 'audio/wav',
      fetchImpl: async (url, init) => {
        seenUrl = String(url);
        const form = init?.body as FormData;
        assert.equal(form.get('language'), 'ru');
        assert.equal(form.get('provider'), 'configured');
        assert.equal((init?.headers as Record<string, string>).authorization, 'Bearer secret');
        return new Response(JSON.stringify({ segments: [{ start: 0, end: 1, text: 'алло', speaker: 'a' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });
    assert.equal(seenUrl, 'http://speech.test/v1');
    assert.equal((body as { segments: Array<{ text: string }> }).segments[0].text, 'алло');
  });

  it('treats a provider error as transport failure', async () => {
    await assert.rejects(
      () =>
        requestTranscript({
          url: 'http://speech.test/v1',
          apiKey: '',
          provider: null,
          timeoutMs: 1000,
          bytes: Buffer.from('audio'),
          filename: 'call.wav',
          contentType: 'audio/wav',
          fetchImpl: async () => new Response('no', { status: 503 }),
        }),
      SpeechTransportError,
    );
  });
});
