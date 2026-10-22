export const MAX_AUDIO_BYTES = 512 * 1024 * 1024;

export type FetchAudioResult =
  | { ok: true; body: Buffer; contentType: string | null }
  | { ok: false; kind: 'missing' | 'retry' };

export async function fetchAudio(
  url: string,
  timeoutMs: number,
  fetchImpl: typeof fetch = fetch,
  maxBytes = MAX_AUDIO_BYTES,
): Promise<FetchAudioResult> {
  try {
    const response = await fetchImpl(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status === 404 || response.status === 410) {
      await cancel(response);
      return { ok: false, kind: 'missing' };
    }
    if (response.status === 408 || response.status === 429 || response.status >= 500 || !response.ok) {
      await cancel(response);
      return { ok: false, kind: 'retry' };
    }
    const declared = Number(response.headers.get('content-length') ?? '');
    if (Number.isFinite(declared) && declared > maxBytes) {
      await cancel(response);
      return { ok: false, kind: 'retry' };
    }
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length === 0 || body.length > maxBytes) {
      return { ok: false, kind: 'retry' };
    }
    return { ok: true, body, contentType: response.headers.get('content-type') };
  } catch {
    return { ok: false, kind: 'retry' };
  }
}

async function cancel(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The status is already known.
  }
}
