import type { ConversationSummary } from '@chatofy/types';

/** Long enough to tell titles apart, short enough for any file system's limit. */
const SLUG_MAX_CHARS = 60;

/**
 * A title as an ASCII, kebab-case file name stem: "Đặt bàn nhà hàng" →
 * "dat-ban-nha-hang".
 *
 * Diacritics are decomposed and dropped, and `đ` — a letter of its own rather than
 * `d` with a mark, so NFD leaves it alone — is mapped by hand. Anything that is not
 * a latin letter or digit after that becomes a separator. A title with nothing
 * left (untitled, or written wholly in another script) falls back to
 * `conversation`, never to an empty name or a bare date.
 */
export function slugify(title: string | null): string {
  const slug = (title ?? '')
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_CHARS)
    .replace(/-+$/, '');
  return slug || 'conversation';
}

/** The local calendar day a conversation started on, as `YYYY-MM-DD`. */
function startDay(startedAt: string): string {
  const date = new Date(startedAt);
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** `slug(title)-YYYY-MM-DD.ext` — the name every download of one conversation shares. */
export function exportFilename(
  conversation: Pick<ConversationSummary, 'title' | 'startedAt'>,
  extension: string,
): string {
  return `${slugify(conversation.title)}-${startDay(conversation.startedAt)}.${extension}`;
}

/**
 * The extension a stored recording should be saved under, from the type the API
 * answered with. `MediaRecorder` writes WebM in Chromium and Firefox; Safari
 * records MP4/AAC, and an Ogg/Opus container is the remaining case worth naming.
 * Anything unknown is saved as `.webm`, which is what this product records.
 */
export function recordingExtension(type: string): 'webm' | 'ogg' | 'm4a' {
  const mime = type.toLowerCase();
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('mp4') || mime.includes('aac') || mime.includes('m4a')) return 'm4a';
  return 'webm';
}
