export type DurationRead = {
  seconds: number;
  via: 'metadata' | 'file';
};

const MAX_SECONDS = 24 * 60 * 60;

export function readAudioDuration(bytes: Buffer): DurationRead | null {
  const metadata = durationFromMetadata(bytes);
  if (metadata !== null) {
    return { seconds: metadata, via: 'metadata' };
  }
  const file = durationFromFile(bytes);
  if (file !== null) {
    return { seconds: file, via: 'file' };
  }
  return null;
}

export function wholeSeconds(seconds: number): number | null {
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > MAX_SECONDS) {
    return null;
  }
  const whole = Math.round(seconds);
  if (!Number.isInteger(whole) || whole < 0 || whole > MAX_SECONDS) {
    return null;
  }
  return whole;
}

function durationFromMetadata(bytes: Buffer): number | null {
  const tlenMs = id3TlenMs(bytes);
  if (tlenMs === null) {
    return null;
  }
  return tlenMs / 1000;
}

function durationFromFile(bytes: Buffer): number | null {
  if (isWav(bytes)) {
    return wavDuration(bytes);
  }
  if (isOgg(bytes)) {
    return oggDuration(bytes);
  }
  return mp3Duration(bytes);
}

function isWav(bytes: Buffer): boolean {
  return bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE';
}

function isOgg(bytes: Buffer): boolean {
  return bytes.length >= 4 && bytes.toString('ascii', 0, 4) === 'OggS';
}

function syncsafe(bytes: Buffer, offset: number): number {
  return (
    ((bytes[offset] & 0x7f) << 21) |
    ((bytes[offset + 1] & 0x7f) << 14) |
    ((bytes[offset + 2] & 0x7f) << 7) |
    (bytes[offset + 3] & 0x7f)
  );
}

function id3TlenMs(bytes: Buffer): number | null {
  if (bytes.length < 10 || bytes.toString('ascii', 0, 3) !== 'ID3') {
    return null;
  }
  const version = bytes[3];
  if (version !== 3 && version !== 4) {
    return null;
  }
  let offset = 10;
  const end = Math.min(bytes.length, 10 + syncsafe(bytes, 6));
  if ((bytes[5] & 0x40) !== 0 && offset + 4 <= end) {
    const extSize = version === 4 ? syncsafe(bytes, offset) : bytes.readUInt32BE(offset);
    offset += extSize;
  }
  while (offset + 10 <= end) {
    const id = bytes.toString('ascii', offset, offset + 4);
    if (!/^[A-Z0-9]{4}$/.test(id)) {
      break;
    }
    const size = version === 4 ? syncsafe(bytes, offset + 4) : bytes.readUInt32BE(offset + 4);
    const dataStart = offset + 10;
    if (size < 0 || dataStart + size > bytes.length) {
      break;
    }
    if (id === 'TLEN' && size > 1) {
      const encoding = bytes[dataStart];
      const raw =
        encoding === 1 || encoding === 2
          ? bytes.toString('utf16le', dataStart + 1, dataStart + size)
          : bytes.toString('latin1', dataStart + 1, dataStart + size);
      const ms = Number(raw.replace(/\0/g, '').trim());
      if (Number.isFinite(ms) && ms >= 0) {
        return ms;
      }
    }
    if (size === 0) {
      break;
    }
    offset = dataStart + size;
  }
  return null;
}

function wavDuration(bytes: Buffer): number | null {
  let offset = 12;
  let byteRate: number | null = null;
  let dataSize: number | null = null;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString('ascii', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const data = offset + 8;
    if (data > bytes.length) {
      break;
    }
    if (id === 'fmt ' && size >= 16 && data + 12 <= bytes.length) {
      const rate = bytes.readUInt32LE(data + 8);
      if (rate > 0) {
        byteRate = rate;
      }
    } else if (id === 'data') {
      const available = Math.max(0, bytes.length - data);
      dataSize = Math.min(size, available);
    }
    const step = size + (size % 2);
    if (step < 0 || data + step > bytes.length + 1) {
      break;
    }
    offset = data + step;
    if (id === 'data') {
      break;
    }
  }
  if (!byteRate || dataSize === null) {
    return null;
  }
  return dataSize / byteRate;
}

const MPEG1_BITRATE: Record<number, number[]> = {
  1: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 0],
  2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, 0],
  3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0],
};

const MPEG2_BITRATE: Record<number, number[]> = {
  1: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256, 0],
  2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
  3: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
};

function mp3Duration(bytes: Buffer): number | null {
  let offset = 0;
  if (bytes.toString('ascii', 0, 3) === 'ID3' && bytes.length >= 10) {
    offset = Math.min(bytes.length, 10 + syncsafe(bytes, 6));
  }
  let limit = bytes.length;
  if (limit >= 128 && bytes.toString('ascii', limit - 128, limit - 125) === 'TAG') {
    limit -= 128;
  }
  let samples = 0;
  let rate = 0;
  let frames = 0;
  while (offset + 4 <= limit) {
    const parsed = mp3Frame(bytes, offset, limit);
    if (!parsed) {
      offset += 1;
      continue;
    }
    samples += parsed.samples;
    rate = parsed.sampleRate;
    frames += 1;
    offset += parsed.length;
  }
  if (frames === 0 || rate === 0) {
    return null;
  }
  return samples / rate;
}

function mp3Frame(
  bytes: Buffer,
  offset: number,
  limit: number,
): { length: number; samples: number; sampleRate: number } | null {
  if (bytes[offset] !== 0xff || (bytes[offset + 1] & 0xe0) !== 0xe0) {
    return null;
  }
  const header = bytes.readUInt32BE(offset);
  const versionId = (header >> 19) & 3;
  const layerId = (header >> 17) & 3;
  const bitrateIndex = (header >> 12) & 0xf;
  const rateIndex = (header >> 10) & 3;
  const padding = (header >> 9) & 1;
  if (versionId === 1 || layerId === 0 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) {
    return null;
  }
  const layer = layerId === 3 ? 1 : layerId === 2 ? 2 : 3;
  const table = versionId === 3 ? MPEG1_BITRATE[layer] : MPEG2_BITRATE[layer];
  const bitrateKbps = table[bitrateIndex];
  const sampleRate = sampleRateFor(versionId, rateIndex);
  if (!bitrateKbps || !sampleRate) {
    return null;
  }
  const bitrate = bitrateKbps * 1000;
  const samples = samplesPerFrame(versionId, layer);
  const length =
    layer === 1
      ? Math.floor((12 * bitrate) / sampleRate + padding) * 4
      : Math.floor(((versionId === 3 ? 144 : 72) * bitrate) / sampleRate + padding);
  if (length < 4 || offset + length > limit) {
    return null;
  }
  const next = offset + length;
  if (next + 1 < limit && (bytes[next] !== 0xff || (bytes[next + 1] & 0xe0) !== 0xe0)) {
    return null;
  }
  return { length, samples, sampleRate };
}

function sampleRateFor(versionId: number, index: number): number | null {
  const rates =
    versionId === 3 ? [44100, 48000, 32000] : versionId === 2 ? [22050, 24000, 16000] : [11025, 12000, 8000];
  return rates[index] ?? null;
}

function samplesPerFrame(versionId: number, layer: number): number {
  if (layer === 1) {
    return 384;
  }
  if (versionId === 3) {
    return 1152;
  }
  return layer === 3 ? 576 : 1152;
}

function oggDuration(bytes: Buffer): number | null {
  let offset = 0;
  let sampleRate: number | null = null;
  let preskip = 0;
  let granule = 0;
  while (offset + 27 <= bytes.length) {
    if (bytes.toString('ascii', offset, offset + 4) !== 'OggS') {
      offset += 1;
      continue;
    }
    const pageGranule = bytes.readBigInt64LE(offset + 6);
    const segments = bytes[offset + 26];
    const table = offset + 27;
    if (table + segments > bytes.length) {
      break;
    }
    let bodyLen = 0;
    for (let i = 0; i < segments; i += 1) {
      bodyLen += bytes[table + i];
    }
    const body = table + segments;
    if (body + bodyLen > bytes.length) {
      break;
    }
    if (pageGranule >= 0n) {
      const asNumber = Number(pageGranule);
      if (Number.isFinite(asNumber) && asNumber > granule) {
        granule = asNumber;
      }
    }
    if (sampleRate === null) {
      const packet = firstPacket(bytes, table, segments, body);
      if (packet && packet.length >= 16 && packet[0] === 1 && packet.toString('ascii', 1, 7) === 'vorbis') {
        const rate = packet.readUInt32LE(12);
        if (rate > 0) {
          sampleRate = rate;
        }
      } else if (packet && packet.length >= 12 && packet.toString('ascii', 0, 8) === 'OpusHead') {
        sampleRate = 48000;
        preskip = packet.readUInt16LE(10);
      }
    }
    offset = body + bodyLen;
  }
  if (!sampleRate || granule <= preskip) {
    return null;
  }
  return (granule - preskip) / sampleRate;
}

function firstPacket(bytes: Buffer, table: number, segments: number, body: number): Buffer | null {
  let size = 0;
  for (let i = 0; i < segments; i += 1) {
    const part = bytes[table + i];
    size += part;
    if (part < 255) {
      if (body + size > bytes.length) {
        return null;
      }
      return bytes.subarray(body, body + size);
    }
  }
  if (body + size > bytes.length) {
    return null;
  }
  return bytes.subarray(body, body + size);
}
