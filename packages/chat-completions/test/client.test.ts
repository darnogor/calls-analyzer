import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ChatCompletionsClient, ChatTransportError, chatCompletionsUrl } from '../src/index';

describe('chat completions url', () => {
  it('appends the protocol path and keeps an endpoint that already has it', () => {
    assert.equal(chatCompletionsUrl('http://llm.test/v1/'), 'http://llm.test/v1/chat/completions');
    assert.equal(
      chatCompletionsUrl('http://llm.test/v1/chat/completions'),
      'http://llm.test/v1/chat/completions',
    );
  });
});

describe('chat completions client', () => {
  it('sends json_object and the configured model, and returns the served model and raw content', async () => {
    let seen: { url: string; body: Record<string, unknown>; authorization: string } | undefined;
    const client = new ChatCompletionsClient({
      baseUrl: 'http://llm.test/v1',
      apiKey: 'secret',
      timeoutMs: 1000,
      fetchImpl: async (url, init) => {
        seen = {
          url: String(url),
          body: JSON.parse(String(init?.body)),
          authorization: String((init?.headers as Record<string, string>).authorization),
        };
        return new Response(
          JSON.stringify({
            model: 'served-model',
            choices: [{ message: { content: 'not json {' } }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
    });
    const result = await client.complete({
      model: 'configured-model',
      messages: [{ role: 'user', content: 'payload' }],
    });
    assert.equal(seen?.url, 'http://llm.test/v1/chat/completions');
    assert.equal(seen?.authorization, 'Bearer secret');
    assert.equal(seen?.body.model, 'configured-model');
    assert.deepEqual(seen?.body.response_format, { type: 'json_object' });
    assert.equal(result.model, 'served-model');
    assert.equal(result.content, 'not json {');
  });

  it('keeps the requested model when the response does not name another one', async () => {
    const client = new ChatCompletionsClient({
      baseUrl: 'http://llm.test/v1',
      apiKey: 'secret',
      timeoutMs: 1000,
      fetchImpl: async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    });
    const result = await client.complete({
      model: 'configured-model',
      messages: [{ role: 'user', content: '{}' }],
    });
    assert.equal(result.model, 'configured-model');
    assert.equal(result.content, '{}');
  });

  it('times out and rejects a non-2xx response without reading a score out of the body', async () => {
    const hanging = new ChatCompletionsClient({
      baseUrl: 'http://llm.test/v1',
      apiKey: 'secret',
      timeoutMs: 20,
      fetchImpl: (_url, init) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal;
          const fail = () => reject(signal?.reason ?? new Error('aborted'));
          if (!signal) {
            reject(new Error('missing signal'));
            return;
          }
          if (signal.aborted) {
            fail();
            return;
          }
          signal.addEventListener('abort', fail, { once: true });
        }),
    });
    const pending = hanging.complete({ model: 'm', messages: [] });
    const outcome = await Promise.race([
      pending.then(
        () => 'resolved',
        (error: unknown) => error,
      ),
      new Promise((resolve) => setTimeout(() => resolve('still-pending'), 200)),
    ]);
    assert.ok(outcome instanceof ChatTransportError);

    const failing = new ChatCompletionsClient({
      baseUrl: 'http://llm.test/v1',
      apiKey: 'secret',
      timeoutMs: 1000,
      fetchImpl: async () =>
        new Response('{"stages":{}}', { status: 503, headers: { 'content-type': 'application/json' } }),
    });
    await assert.rejects(() => failing.complete({ model: 'm', messages: [] }), (error: unknown) => {
      assert.ok(error instanceof ChatTransportError);
      assert.match(error.message, /503/);
      return true;
    });
  });
});
