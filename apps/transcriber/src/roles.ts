export type Replica = {
  speaker: 'manager' | 'client';
  start: number;
  end: number;
  text: string;
};

type Segment = {
  start: number;
  end: number;
  text: string;
  speaker: string;
};

export function replicasFromSpeech(body: unknown, direction: string | null): Replica[] {
  const channels = readChannels(body);
  if (channels && channels.length >= 2) {
    const replicas: Replica[] = [];
    channels.forEach((segments, index) => {
      const speaker: 'manager' | 'client' = index === 0 ? 'manager' : 'client';
      for (const segment of segments) {
        replicas.push({
          speaker,
          start: segment.start,
          end: segment.end,
          text: segment.text,
        });
      }
    });
    replicas.sort((left, right) => left.start - right.start || left.end - right.end);
    return replicas;
  }
  const singleTrack = channels?.length === 1 ? channels[0] : [];
  const segments = singleTrack.length > 0 ? singleTrack : readSegments(body);
  return assignRoles(segments, direction);
}

function readChannels(body: unknown): Segment[][] | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return null;
  }
  const raw = (body as { channels?: unknown }).channels;
  if (!Array.isArray(raw) || raw.length === 0) {
    return null;
  }
  const indexed = raw.map((channel, index) => ({
    index: channelIndex(channel, index),
    segments: readSegments(channelSegments(channel)),
  }));
  indexed.sort((left, right) => left.index - right.index);
  return indexed.map((channel) => channel.segments);
}

function channelIndex(channel: unknown, fallback: number): number {
  if (!channel || typeof channel !== 'object' || Array.isArray(channel)) {
    return fallback;
  }
  const record = channel as { channel?: unknown; id?: unknown };
  const value = record.channel ?? record.id;
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : fallback;
}

function channelSegments(channel: unknown): unknown {
  if (Array.isArray(channel)) {
    return channel;
  }
  if (channel && typeof channel === 'object' && Array.isArray((channel as { segments?: unknown }).segments)) {
    return (channel as { segments: unknown }).segments;
  }
  return [];
}

function readSegments(body: unknown): Segment[] {
  const raw = Array.isArray(body)
    ? body
    : body && typeof body === 'object' && Array.isArray((body as { segments?: unknown }).segments)
      ? (body as { segments: unknown[] }).segments
      : [];
  const segments: Segment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const record = item as { start?: unknown; end?: unknown; text?: unknown; speaker?: unknown };
    const start = readNumber(record.start);
    const end = readNumber(record.end);
    const text = typeof record.text === 'string' ? record.text.trim() : '';
    if (start === null || end === null || !(end > start) || text === '') {
      continue;
    }
    segments.push({ start, end, text, speaker: speakerLabel(record.speaker) });
  }
  return segments;
}

function assignRoles(segments: Segment[], direction: string | null): Replica[] {
  const sorted = [...segments].sort((left, right) => left.start - right.start || left.end - right.end);
  const order: string[] = [];
  for (const segment of sorted) {
    if (!order.includes(segment.speaker)) {
      order.push(segment.speaker);
    }
  }
  const first: 'manager' | 'client' = direction === 'in' ? 'client' : 'manager';
  const second: 'manager' | 'client' = first === 'manager' ? 'client' : 'manager';
  const roles = new Map<string, 'manager' | 'client'>();
  order.forEach((label, index) => {
    if (index === 0) {
      roles.set(label, first);
    } else if (index === 1) {
      roles.set(label, second);
    } else {
      roles.set(label, 'client');
    }
  });
  return sorted.map((segment) => ({
    speaker: roles.get(segment.speaker) ?? 'client',
    start: segment.start,
    end: segment.end,
    text: segment.text,
  }));
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function speakerLabel(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return '';
}
