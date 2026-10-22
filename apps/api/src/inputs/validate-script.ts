export type ScriptBody = {
  title: string;
  body: string;
};

export function parseScript(value: unknown): ScriptBody | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if ('kind' in record && record.kind !== 'script') {
    return null;
  }
  if (typeof record.title !== 'string' || typeof record.body !== 'string') {
    return null;
  }
  const title = record.title.trim();
  const body = record.body.trim();
  if (!title || !body) {
    return null;
  }
  return { title, body };
}
