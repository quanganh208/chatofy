/**
 * How a stored conversation is described in History: the title, the language line,
 * the length, and the turns of the detail view. Pure, so the wording rules are
 * tested without a screen.
 */

import {
  isAutoDetectConversation,
  SEARCH_LIMITS,
  type ConversationSummary,
  type ConversationTurn,
  type LanguageCode,
} from '@chatofy/types';
import { pickTranslation } from '../translate/turn-display.ts';

/** The search term to send: trimmed, and empty while it is too short for the API to accept. */
export function searchTerm(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.length >= SEARCH_LIMITS.MIN_CHARS ? trimmed.slice(0, SEARCH_LIMITS.MAX_CHARS) : '';
}

/** What the conversation is called: its written title, else the start of what was said. */
export function titleOf(
  conversation: Pick<ConversationSummary, 'title' | 'preview'>,
): string | null {
  const title = conversation.title?.trim();
  if (title) return title;
  const preview = conversation.preview.trim();
  return preview.length > 0 ? preview : null;
}

/**
 * The languages of a stored conversation. An auto-detected one stores the whole
 * registry with the output language first, so it reads as "Auto-detect" and names
 * only that output.
 */
export function languageLine(languages: readonly LanguageCode[]): {
  kind: 'pair' | 'detect';
  from: LanguageCode | null;
  to: LanguageCode;
} {
  const [first, second] = languages;
  if (isAutoDetectConversation(languages))
    return { kind: 'detect', from: null, to: first as LanguageCode };
  return { kind: 'pair', from: first as LanguageCode, to: second as LanguageCode };
}

/** Whole minutes the conversation ran, paused time left out; at least 1 for any that ran at all. */
export function durationMinutes(
  conversation: Pick<ConversationSummary, 'startedAt' | 'endedAt' | 'pausedMs'>,
): number {
  const ms =
    Date.parse(conversation.endedAt) - Date.parse(conversation.startedAt) - conversation.pausedMs;
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.max(1, Math.round(ms / 60_000));
}

export interface DetailTurn {
  position: number;
  sourceLanguage: LanguageCode | undefined;
  mixed: boolean;
  /** Repaired text where one was stored, else the recognised text. */
  sourceText: string;
  translationLanguage: LanguageCode | undefined;
  translation: string;
  speakerLabel: string | null;
}

/** The turns of a stored conversation as lines to read, oldest first. */
export function detailTurns(turns: readonly ConversationTurn[]): DetailTurn[] {
  return [...turns]
    .sort((a, b) => a.position - b.position)
    .map((turn) => {
      const picked = pickTranslation(turn.translations, turn.sourceLanguages);
      return {
        position: turn.position,
        sourceLanguage: turn.sourceLanguages.length === 1 ? turn.sourceLanguages[0] : undefined,
        mixed: turn.sourceLanguages.length > 1,
        sourceText: turn.displayText ?? turn.sourceText,
        translationLanguage: picked?.language,
        translation: picked?.text ?? '',
        speakerLabel: turn.speakerLabel,
      };
    });
}
