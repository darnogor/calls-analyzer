export class ChatTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChatTransportError';
  }
}

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type ChatCompletion = {
  model: string;
  content: string;
};

export type ChatClientOptions = {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
};

export function chatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (trimmed.endsWith('/chat/completions')) {
    return trimmed;
  }
  return `${trimmed}/chat/completions`;
}

export class ChatCompletionsClient {
  constructor(private readonly options: ChatClientOptions) {}

  async complete(input: { model: string; messages: ChatMessage[] }): Promise<ChatCompletion> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    let response: Response;
    try {
      response = await fetchImpl(chatCompletionsUrl(this.options.baseUrl), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: input.model,
          messages: input.messages,
          response_format: { type: 'json_object' },
        }),
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch (error) {
      throw new ChatTransportError(error instanceof Error ? error.message : 'request failed');
    }
    if (!response.ok) {
      throw new ChatTransportError(`status ${response.status}`);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      throw new ChatTransportError(error instanceof Error ? error.message : 'invalid response');
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new ChatTransportError('invalid response');
    }
    const record = body as { model?: unknown; choices?: unknown };
    const content = readContent(record.choices);
    if (content === null) {
      throw new ChatTransportError('missing content');
    }
    const served = typeof record.model === 'string' ? record.model.trim() : '';
    return {
      model: served || input.model,
      content,
    };
  }
}

function readContent(choices: unknown): string | null {
  if (!Array.isArray(choices) || choices.length === 0) {
    return null;
  }
  const first = choices[0];
  if (!first || typeof first !== 'object') {
    return null;
  }
  const message = (first as { message?: unknown }).message;
  if (!message || typeof message !== 'object') {
    return null;
  }
  const content = (message as { content?: unknown }).content;
  return typeof content === 'string' ? content : null;
}
