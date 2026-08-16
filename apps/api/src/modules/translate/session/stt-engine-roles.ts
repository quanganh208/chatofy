import {
  directionLanguages,
  type LanguageCode,
  type TranslationDirection,
} from '@chatofy/types';

/**
 * Which recognizer reads for the SCREEN, where a different one reads for speech.
 *
 * Vietnamese has both: a causal engine whose output is spoken as it arrives, and
 * an offline one measured at 5.38% against the causal one's 10.93% on VIVOS-50.
 * The screen takes the accurate one, and the reason is the whole split — audio
 * that has played cannot be recalled, so the spoken path must never revise
 * itself, while `server.transcript.partial` is defined as replacing what came
 * before. Charging the screen the accuracy price of a guarantee it does not use
 * is charging a path that gains nothing from it.
 *
 * A language absent from this map has one engine, and naming it would only be a
 * second place to keep in sync with the sidecar — which rejects a name it does
 * not serve rather than quietly substituting one.
 */
const DISPLAY_STT_ENGINE: Partial<Record<LanguageCode, string>> = {
  vi: 'zipformer',
};

/**
 * The engine the on-screen transcript should ask for, or undefined for the
 * language's default.
 *
 * Shared rather than duplicated because two callers need the same answer for
 * different halves of one turn: the live transcript while the speaker talks, and
 * the final transcript once they stop. Those two disagreeing would show a
 * listener their sentence being retyped in a different recognizer's words at the
 * moment the turn ends.
 */
export function displayEngineFor(
  direction: TranslationDirection,
): string | undefined {
  return DISPLAY_STT_ENGINE[directionLanguages(direction).source];
}

/**
 * Whether this direction's source language has a causal recognizer at all.
 *
 * Asked before opening a session, not discovered from the 409 that comes back.
 * English has one engine and it decodes whole utterances, so every English turn
 * was paying a round trip and a warning log to be told something knowable here —
 * and while that round trip was in flight, its commits were suppressed.
 */
export function hasCausalEngine(direction: TranslationDirection): boolean {
  return directionLanguages(direction).source === 'vi';
}
