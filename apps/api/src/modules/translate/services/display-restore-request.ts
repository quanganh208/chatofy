import type { LanguageCode } from '@chatofy/types';
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
