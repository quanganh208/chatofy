/**
 * The meeting end screen's readouts — how long it ran, who was in it, which
 * languages it was held in — worded once for web and mobile.
 *
 * Each app used to format these itself and the two drifted: mobile printed a
 * language code it could not name, web left it out. The inputs are plain values
 * (minutes, display names, codes) so this package keeps no dependency; the apps
 * compute them from the room's detail.
 */
import { en, type MessageKey } from './en.js';
import type { Translate } from './t.js';

/** What a row with nothing to show reads as. */
const NONE = '—';

/**
 * Rounded minutes as "{minutes} min" or "{hours} h {minutes} min". `null` means
 * there is no end yet — someone is still in the room — and it says so.
 */
export function meetingDuration(t: Translate, minutes: number | null): string {
  if (minutes === null) return t('common.conference.durationUnknown');
  if (minutes < 60) return t('common.conference.durationMinutes', { minutes });
  return t('common.conference.durationHours', {
    hours: Math.floor(minutes / 60),
    minutes: minutes % 60,
  });
}

/** Everyone who took part, in join order; a blank name is a guest. */
export function meetingParticipants(
  t: Translate,
  displayNames: readonly (string | null | undefined)[],
): string {
  const names = displayNames.map((name) => name?.trim() || t('common.conference.guest'));
  return names.join(', ') || NONE;
}

/**
 * The distinct languages spoken, in first-seen order and in the reader's locale.
 * A code with no `common.languageName` entry has no name to show, so it is left
 * out rather than printed raw. Two read as a pair ("Vietnamese ↔ English").
 */
export function meetingLanguages(t: Translate, codes: readonly string[]): string {
  const names = [...new Set(codes)].flatMap((code) => {
    const key = `common.languageName.${code}`;
    return Object.hasOwn(en, key) ? [t(key as MessageKey)] : [];
  });
  return (names.length === 2 ? names.join(' ↔ ') : names.join(', ')) || NONE;
}
