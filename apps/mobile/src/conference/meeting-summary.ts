/**
 * The end screen's readouts, computed from the room's detail: who was in it and
 * which languages were spoken. The same rules as the web's summary card, so a
 * meeting reads the same on both; how long it ran is `conferenceDurationMinutes`
 * from `@chatofy/types`, shared by both.
 *
 * Pure (no React Native imports), so the rules run under `node --test`.
 */

import type { ConferenceDetailResponse } from '@chatofy/types';

/** Everyone who took part, in join order; a participant with no name is `guestLabel`. */
export function participantNames(
  conference: Pick<ConferenceDetailResponse, 'participants'>,
  guestLabel: string,
): string[] {
  return conference.participants.map((p) => p.displayName?.trim() || guestLabel);
}

/** The distinct languages spoken, in first-seen order. */
export function spokenLanguages(
  conference: Pick<ConferenceDetailResponse, 'participants'>,
): string[] {
  return [...new Set(conference.participants.map((p) => p.sourceLanguage))];
}
