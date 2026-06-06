// Small shared helpers for fetch-based providers.

/** Truncate an upstream error body so we never log huge payloads. */
export function truncate(text: string, max = 300): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Map an audio MIME type to a file extension for multipart uploads. */
export function extFromMime(mimeType: string): string {
  const map: Record<string, string> = {
    'audio/webm': 'webm',
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/flac': 'flac',
  };
  return map[mimeType.split(';')[0]?.trim() ?? ''] ?? 'bin';
}
