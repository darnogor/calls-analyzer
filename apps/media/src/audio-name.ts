const KNOWN = new Set(['mp3', 'wav', 'ogg', 'mpeg']);

const MIME_EXT: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/wave': 'wav',
  'audio/x-wav': 'wav',
  'audio/ogg': 'ogg',
  'application/ogg': 'ogg',
  'video/mpeg': 'mpeg',
  'audio/x-mpeg': 'mpeg',
};

const CANONICAL: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  mpeg: 'video/mpeg',
};

export function objectExtension(
  contentType: string | null,
  url: string | null,
): { ext: string; contentType: string } {
  const raw = contentType?.split(';')[0].trim().toLowerCase() ?? '';
  const fromMime = raw ? MIME_EXT[raw] : undefined;
  const fromUrl = extensionFromUrl(url);
  const ext = fromMime ?? (fromUrl && KNOWN.has(fromUrl) ? fromUrl : undefined) ?? 'bin';
  return {
    ext,
    contentType: raw || CANONICAL[ext] || 'application/octet-stream',
  };
}

function extensionFromUrl(url: string | null): string | null {
  if (!url) {
    return null;
  }
  try {
    const pathname = new URL(url).pathname;
    const base = pathname.split('/').pop() ?? '';
    const dot = base.lastIndexOf('.');
    if (dot < 0 || dot === base.length - 1) {
      return null;
    }
    return base.slice(dot + 1).toLowerCase();
  } catch {
    return null;
  }
}
