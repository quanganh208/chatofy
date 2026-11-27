import { realtimeErrorKey, type MessageKey } from '@chatofy/i18n';
import type { RealtimeErrorCause } from '@chatofy/realtime-client';
import { creditErrorMessage } from './credits';
import { t } from './i18n';

/**
 * An error whose `message` is already a sentence in the reader's language.
 *
 * Every failure this extension shows travels as a string — from the offscreen
 * document to the worker to the overlay — so the only safe moment to decide what a
 * reader sees is where the error is caught. A plain `Error` there may carry Chrome's,
 * the browser's or a library's English, written for a developer; this class is how
 * the extension marks the ones it wrote for a person.
 */
export class ReaderFacingError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ReaderFacingError';
  }
}

/**
 * What to show for a caught failure: its own sentence when the extension wrote one,
 * otherwise the caller's fallback. Never a foreign error's English `message`.
 */
export function readerMessage(err: unknown, fallback: MessageKey): string {
  return err instanceof ReaderFacingError ? err.message : t(fallback);
}

/**
 * A translation session's failure in the reader's words, chosen by its code: the
 * message the session reported beside it is English for logs. The credit codes are
 * worded with what the leg knows (whether a turn had opened); every other code takes
 * the shared table, which gives a code it does not know a generic sentence.
 */
export function sessionFailureMessage(
  cause: RealtimeErrorCause | undefined,
  context: { turnOpened: boolean },
): string {
  return creditErrorMessage(cause, context) ?? t(realtimeErrorKey(cause));
}
