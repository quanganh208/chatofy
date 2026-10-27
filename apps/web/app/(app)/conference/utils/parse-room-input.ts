import { conferenceRoomIdSchema } from '@chatofy/types/events';

/**
 * What someone typed or pasted into "Meeting code or link", as a room id.
 *
 * A pasted invite link is `…/conference/<id>`; a link from the old lobby carried
 * the room as `?room=<id>` and may still trail `?name=&lang=`. Anything that is
 * not a server-minted id answers `null`, so the landing can say "not found"
 * without a socket round trip.
 */
export function parseRoomInput(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  const candidate = fromLink(text) ?? text;
  return conferenceRoomIdSchema.safeParse(candidate).success ? candidate : null;
}

/** The room a link names, or undefined when the text is not a link at all. */
function fromLink(text: string): string | undefined {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return undefined;
  }
  const segments = url.pathname.split('/').filter(Boolean);
  const at = segments.indexOf('conference');
  const segment = at >= 0 ? segments[at + 1] : undefined;
  if (segment) {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  }
  return url.searchParams.get('room') ?? '';
}
