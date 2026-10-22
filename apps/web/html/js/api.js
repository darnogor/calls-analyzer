export class ApiError extends Error {
  constructor(status, body) {
    super(typeof body?.error === 'string' ? body.error : 'request_failed');
    this.status = status;
    this.body = body || {};
  }
}

export async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  let body = options.body;
  if (body !== undefined && !(body instanceof FormData) && typeof body !== 'string') {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(body);
  }
  const response = await fetch(path, {
    method: options.method || 'GET',
    credentials: 'include',
    headers,
    body,
    signal: options.signal,
  });
  if (response.status === 204) return null;
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: 'invalid_json' };
    }
  }
  if (!response.ok) throw new ApiError(response.status, data || {});
  return data;
}
