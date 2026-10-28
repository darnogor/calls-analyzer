export type TranscriptTurn = {
  id: string;
  speaker: string;
  start: number;
  end: number;
  text: string;
};

export function transcriptTurns(value: unknown): TranscriptTurn[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }
  const storedIds = value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return undefined;
    }
    const id = (item as { id?: unknown }).id;
    return typeof id === 'string' && id.trim() !== '' ? id.trim() : '';
  });
  if (storedIds.some((id) => id === undefined)) {
    return null;
  }
  const assign = storedIds.every((id) => id === '');
  const keep = storedIds.every((id) => id !== '');
  if (!assign && !keep) {
    return null;
  }
  const turns: TranscriptTurn[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const record = value[index] as Record<string, unknown>;
    const text = typeof record.text === 'string' ? record.text.trim() : '';
    if (!text) {
      return null;
    }
    const id = assign ? `t${index + 1}` : (storedIds[index] as string);
    if (seen.has(id)) {
      return null;
    }
    seen.add(id);
    const speaker = record.speaker === 'client' ? 'client' : record.speaker === 'manager' ? 'manager' : 'client';
    turns.push({
      id,
      speaker,
      start: typeof record.start === 'number' && Number.isFinite(record.start) ? record.start : 0,
      end: typeof record.end === 'number' && Number.isFinite(record.end) ? record.end : 0,
      text,
    });
  }
  return turns;
}
