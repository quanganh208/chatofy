import type { Logger } from '@nestjs/common';
import type { LanguageCode } from '@chatofy/types';
import {
  inverseNormalizeTranscript,
  normalizeTranscript,
} from '@chatofy/ai-providers';
import type { TurnSession } from '../session/turn-session';
import type { DisplayRestoreRequest } from './pipeline-translator.service';

/**
 * Recognition languages whose transcript arrives with no punctuation or case.
 *
 * Only Vietnamese: the zipformer emits bare uppercase syllables, while the
 * English recognizer (Parakeet) already writes cased, punctuated text, and
 * the sidecar's restorer refuses any other language.
 */
const RESTORED_RECOGNITION: readonly LanguageCode[] = ['vi'];

/**
 * What a turn asks the display restorer for, or `undefined` when it asks nothing.
 *
 * Nothing unless the client asked for a display at all (`repairDisplay`): a
 * client that renders the raw transcript would pay for a restore it throws away.
 *
 * `continued` is the transcript of the turn this one continues, named by the
 * caller only when it could prove which turn that was. Reading it is what keeps
 * the seam from opening with a capital.
 */
export function restoreRequestFor(
  session: TurnSession,
  continued: string | undefined,
): DisplayRestoreRequest | undefined {
  if (!session.repairDisplay) return undefined;
  if (!RESTORED_RECOGNITION.includes(session.languages.recognition))
    return undefined;
  return {
    ...(continued === undefined ? {} : { context: continued }),
    terms: session.hints?.hotwords ?? [],
  };
}

/** A line's words in order, case and marks aside. */
function wordsOf(text: string): string {
  return (
    text
      .normalize('NFC')
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  ).join(' ');
}

/**
 * Whether a restored line still says exactly what the recognizer heard.
 *
 * The restorer is a tagger and should never change a word, but that promise
 * lives in another process, a model revision and a tokenizer. Checking it here
 * makes it hold by construction: a restore that added, dropped or altered a
 * word is discarded, and the line shows the recognizer's words instead —
 * words nobody said are the failure the LLM repair was removed for.
 */
export function restoreKeepsWords(
  sourceText: string,
  restored: string,
): boolean {
  return wordsOf(restored) === wordsOf(sourceText);
}

/**
 * The readable rendering of `sourceText`, or undefined to show the transcript.
 *
 * `restored` is `sourceText` with punctuation and case restored, when the
 * restorer ran in time; it is typeset in its place, because the ITN reads
 * numerals case-insensitively and leaves marks alone, so the two compose.
 * `recognition` is the language the transcript was heard in, and selects the
 * ITN module.
 *
 * One function for a turn and for a block of turns, so the two lines a reader
 * may see for the same words are typeset by the same rules.
 */
export function typesetTranscript(
  sourceText: string,
  restored: string | undefined,
  recognition: LanguageCode,
  logger: Pick<Logger, 'warn'>,
): string | undefined {
  // A wordless turn has nothing to typeset. The ITN cannot invent words the
  // way a model could, but an event for an empty turn is still noise.
  if (!sourceText.trim()) return undefined;

  if (restored !== undefined && !restoreKeepsWords(sourceText, restored)) {
    logger.warn(
      'display restore changed the words, the turn keeps its plain display',
    );
    restored = undefined;
  }

  let typeset: string;
  let canonical: string;
  try {
    // `recognition` SELECTS the module rather than gating the feature: on
    // `en_to_vi` the transcript being typeset is the English one, so both
    // directions have an ITN and `ws-events.ts`'s bidirectional contract stays
    // true.
    // The ITN canonicalizes its input before it does anything else, so the
    // string to COMPARE against is the canonical one, not the raw one. Against
    // the raw text a transcript that merely arrived with a trailing space or
    // in NFD would "differ" with no numeral in it anywhere, and every such
    // turn would carry a display — putting a "show original" disclosure under
    // a line whose original is identical to it.
    canonical = normalizeTranscript(sourceText);
    typeset = inverseNormalizeTranscript(
      restored === undefined ? canonical : normalizeTranscript(restored),
      recognition,
    );
  } catch (err: unknown) {
    // The ITN is documented as total on a string, and this does not trust it —
    // the same refusal the old `.catch()` here made, for a much sharper
    // reason. This call now sits inside the turn's own `try`, BEFORE the
    // transcript is emitted, and that `catch` runs `record(false, 'error')`,
    // `reportTurnFailure` and `close(..., 'error')`. An unguarded throw would
    // therefore let a cosmetic display feature silence the product — no
    // transcript, no audio — reproducibly, on every turn containing whatever
    // token triggered it.
    logger.warn(
      `display typesetting failed, the turn keeps its raw transcript: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return undefined;
  }

  // Never a blank line. The client falls back with `display ?? sourceText`,
  // and `??` does not catch an empty string — so an ITN that "succeeded" into
  // nothing would erase the turn's words on screen rather than leave them
  // alone. Cheap to rule out here, and it makes "a display value is never
  // empty" true for every reader of this field.
  if (!typeset.trim()) return undefined;

  // Absent when nothing changed. The client reads presence as "this line
  // differs from what the recognizer produced" and shows a "show original"
  // disclosure on it; most turns hold no numerals, so emitting always would
  // put that disclosure under every line with the original identical to the
  // text above it.
  return typeset === canonical ? undefined : typeset;
}

/**
 * `restored` with every word the translation spells in mixed case — "OpenAI",
 * "iPhone", "ChatGPT" — spelled that way.
 *
 * The restorer tags each word lower, Capital or UPPER, so a mixed-case name is
 * beyond it, and no list of such names could be complete. The translation of
 * the same words already holds them: the translator writes "OpenAI's model"
 * from "mô hình của openai". Only mixed case is taken — a capital after the
 * first letter, and not all capitals — the rule the sidecar applies to a
 * caller's hotwords. "AI" is left to the restorer's own reading, because "ai"
 * is also Vietnamese for "who".
 *
 * Case only: a word is replaced by a form whose lowercase is the same word, so
 * {@link restoreKeepsWords} holds across it.
 */
export function adoptTranslatedCasing(
  restored: string,
  translations: Partial<Record<LanguageCode, string>>,
): string {
  const forms = new Map<string, string>();
  for (const text of Object.values(translations)) {
    for (const word of text?.match(WORD) ?? []) {
      if (/\p{Lu}/u.test(word.slice(1)) && word !== word.toUpperCase()) {
        forms.set(word.toLowerCase(), word);
      }
    }
  }
  if (forms.size === 0) return restored;
  return restored.replace(
    WORD,
    (word) => forms.get(word.toLowerCase()) ?? word,
  );
}

/** A run of letters and digits: one word, for matching names across languages. */
const WORD = /[\p{L}\p{N}]+/gu;
