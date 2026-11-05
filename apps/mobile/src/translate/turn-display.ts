/**
 * What each line of the translate screen shows, derived from the transcript state.
 *
 * Pure so the language rules can be tested without rendering. The rule that
 * matters: the translation pane is chosen per TURN, from the language the turn
 * was spoken in, never from the pair's output language. In a two-way conversation
 * the next turn may be in the output language and its translation goes the other
 * way; in Auto-detect a turn already in the output language is shown as
 * transcript only.
 */

import type { LiveTurn } from '@chatofy/realtime-client';
import type { LanguageCode, TranscriptSegment } from '@chatofy/types';

export interface TurnRow {
  /** Stable key: the server's session id. */
  key: string;
  /** Still being spoken or translated. */
  live: boolean;
  /** The language it was spoken in; undefined while the server has not decided. */
  sourceLanguage: LanguageCode | undefined;
  /** A turn that mixes languages has no single one to name. */
  mixed: boolean;
  sourceText: string;
  /** The language the translation below is in; undefined when there is none. */
  translationLanguage: LanguageCode | undefined;
  translation: string;
  /** The translation existed but was never spoken (dropped or stalled). */
  unheard: boolean;
}

/** The translation to show for a turn spoken in `spoken`, and the language it is in. */
export function pickTranslation(
  translations: Partial<Record<LanguageCode, string>>,
  spoken: readonly LanguageCode[],
): { language: LanguageCode; text: string } | null {
  const [only, ...rest] = spoken;
  // A mixed turn is translated into every language of the conversation; show the first
  // that carries text. A single-language turn skips its own language.
  const candidates = (Object.entries(translations) as [LanguageCode, string | undefined][])
    .filter(
      ([language, text]) =>
        text && text.trim().length > 0 && (rest.length > 0 || language !== only),
    )
    .map(([language, text]) => ({ language, text: text as string }));
  return candidates[0] ?? null;
}

export function finishedRow(
  segment: TranscriptSegment,
  display: string | undefined,
  unheard: boolean,
): TurnRow {
  const picked = pickTranslation(segment.translations, segment.sourceLanguages);
  return {
    key: segment.sessionId,
    live: false,
    sourceLanguage: segment.sourceLanguages.length === 1 ? segment.sourceLanguages[0] : undefined,
    mixed: segment.sourceLanguages.length > 1,
    sourceText: display ?? segment.sourceText,
    translationLanguage: picked?.language,
    translation: picked?.text ?? '',
    unheard,
  };
}

/** `outputLanguage` is the pair's declared output, the language a live guess is written in. */
export function liveRow(sessionId: string, live: LiveTurn, outputLanguage: LanguageCode): TurnRow {
  return {
    key: sessionId,
    live: true,
    sourceLanguage: live.language,
    mixed: false,
    sourceText: live.text,
    translationLanguage: live.translation ? outputLanguage : undefined,
    translation: live.translation,
    unheard: false,
  };
}

/** Finished turns oldest first, then the turns still being spoken. */
export function turnRows(
  turns: readonly TranscriptSegment[],
  displays: Record<string, string>,
  unheard: Record<string, unknown>,
  liveTurns: readonly ({ sessionId: string } & LiveTurn)[],
  outputLanguage: LanguageCode,
): TurnRow[] {
  const finished = turns.map((segment) =>
    finishedRow(segment, displays[segment.sessionId], segment.sessionId in unheard),
  );
  const finishedKeys = new Set(finished.map((row) => row.key));
  // A live line whose turn has already finished is stale; the reducer clears it, this is the belt.
  const live = liveTurns
    .filter((turn) => !finishedKeys.has(turn.sessionId) && turn.text.length > 0)
    .map((turn) => liveRow(turn.sessionId, turn, outputLanguage));
  return [...finished, ...live];
}
