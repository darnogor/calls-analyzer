export class SpeechTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpeechTransportError';
  }
}

export function speechEndpoint(env: {
  STT_API_URL?: string;
  STT_PROVIDER?: string;
}): { url: string; provider: string | null } | null {
  const apiUrl = blank(env.STT_API_URL);
  const provider = blank(env.STT_PROVIDER);
  const url = apiUrl || (provider && /^https?:\/\//i.test(provider) ? provider : '');
  if (!url) {
    return null;
  }
  return {
    url,
    provider: provider && provider !== url ? provider : null,
  };
}

export async function requestTranscript(options: {
  url: string;
  apiKey: string;
  provider: string | null;
  timeoutMs: number;
  bytes: Buffer;
  filename: string;
  contentType: string;
  fetchImpl?: typeof fetch;
}): Promise<unknown> {
  const form = new FormData();
  form.append('language', 'ru');
  if (options.provider) {
    form.append('provider', options.provider);
  }
  form.append(
    'file',
    new Blob([Uint8Array.from(options.bytes)], { type: options.contentType }),
    options.filename,
  );
  const headers: Record<string, string> = {};
  if (options.apiKey) {
    headers.authorization = `Bearer ${options.apiKey}`;
  }
  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(options.url, {
      method: 'POST',
      headers,
      body: form,
      signal: AbortSignal.timeout(options.timeoutMs),
    });
  } catch (error) {
    throw new SpeechTransportError(error instanceof Error ? error.message : 'request failed');
  }
  if (!response.ok) {
    throw new SpeechTransportError(`status ${response.status}`);
  }
  try {
    return await response.json();
  } catch (error) {
    throw new SpeechTransportError(error instanceof Error ? error.message : 'invalid response');
  }
}

function blank(value: string | undefined): string {
  return value?.trim() ?? '';
}
