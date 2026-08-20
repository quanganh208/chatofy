/**
 * A language code turned into something a person reads.
 *
 * Needed because half the problem is not greppable. `EXPECTED_SOURCE` in the live
 * panel is a fixed pair of codes and easy to replace by hand, but the other half —
 * `live.detectedLanguage` — is whatever the model decided it heard. It is typed
 * `string | null`, not a union, so any code can arrive and a lookup table alone would
 * leave a bare `xh` on screen for anything unlisted.
 *
 * Hence the fallback, which is the part that matters. `Intl.DisplayNames` knows far
 * more codes than a hand-written map, so it does the work; the map only pins the two
 * languages this product is about, so their names never depend on the runtime's
 * locale data. Anything neither knows is described rather than printed, because a
 * two-letter code in a sentence about being misheard is exactly the moment not to
 * show internals.
 */
const PINNED: Record<string, string> = {
  vi: 'Vietnamese',
  en: 'English',
};

export function languageName(code: string | null | undefined): string {
  if (!code) return 'an unknown language';

  const normalized = code.trim().toLowerCase();
  const pinned = PINNED[normalized] ?? PINNED[normalized.split(/[-_]/)[0] ?? ''];
  if (pinned) return pinned;

  try {
    const display = new Intl.DisplayNames(['en'], { type: 'language' }).of(normalized);
    // `of()` echoes the input back when it does not recognise it, which would put the
    // bare code on screen through the front door.
    if (display && display.toLowerCase() !== normalized) return display;
  } catch {
    // An invalid tag throws rather than returning undefined. Same outcome either way.
  }

  return 'another language';
}
