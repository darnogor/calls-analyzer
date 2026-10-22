export type AuthMode = 'session' | 'source' | 'session_or_source';

export function authorizationPresent(value: string | string[] | undefined): boolean {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === 'string' && raw.trim() !== '';
}

export function bearerToken(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') {
    return null;
  }
  const match = /^Bearer\s+(\S+)$/i.exec(raw.trim());
  return match?.[1] ?? null;
}

export function chooseAuth(
  isPublic: boolean,
  mode: AuthMode | undefined,
  authorization: string | string[] | undefined,
): 'public' | 'source' | 'session' {
  if (isPublic) {
    return 'public';
  }
  const selected = mode ?? 'session';
  if (selected === 'source') {
    return 'source';
  }
  if (selected === 'session_or_source' && authorizationPresent(authorization)) {
    return 'source';
  }
  return 'session';
}
