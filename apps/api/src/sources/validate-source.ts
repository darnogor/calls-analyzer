const PROVIDER = /^[a-z0-9_-]+$/;

export function parseNewSource(body: unknown): { provider: string; display_name: string } | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return null;
  }
  const record = body as Record<string, unknown>;
  if (typeof record.provider !== 'string' || !PROVIDER.test(record.provider) || record.provider.length > 64) {
    return null;
  }
  if (typeof record.display_name !== 'string') {
    return null;
  }
  const displayName = record.display_name.trim();
  if (!displayName || displayName.length > 200) {
    return null;
  }
  return { provider: record.provider, display_name: displayName };
}

export function parseSetupCode(body: unknown): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return null;
  }
  const code = (body as { setup_code?: unknown }).setup_code;
  if (typeof code !== 'string' || code.length === 0 || code.length > 200) {
    return null;
  }
  return code;
}
