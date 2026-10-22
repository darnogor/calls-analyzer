const NAME_EXTENSIONS = new Set(['mp3', 'wav', 'ogg', 'mpeg']);

const MIME_EXTENSIONS: Record<string, string> = {
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

const CONTENT_TYPE = /^[\w.+-]+\/[\w.+-]+$/;

export function recordingContentType(value: string | null | undefined): string {
  if (value && CONTENT_TYPE.test(value)) {
    return value;
  }
  return 'application/octet-stream';
}

export function audioObject(file: { originalname?: string; mimetype?: string }): {
  ext: string;
  contentType: string;
} {
  const name = file.originalname ?? '';
  const dot = name.lastIndexOf('.');
  const nameExt = dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
  const mime = (file.mimetype || '').toLowerCase();
  const ext = NAME_EXTENSIONS.has(nameExt) ? nameExt : (MIME_EXTENSIONS[mime] ?? 'bin');
  return {
    ext,
    contentType: file.mimetype && file.mimetype.length > 0 ? file.mimetype : 'application/octet-stream',
  };
}
