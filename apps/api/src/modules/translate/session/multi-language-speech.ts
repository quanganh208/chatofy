import type { LanguageCode } from '@chatofy/types';
import type { ClauseDelivery } from './turn-timeline';

/**
 * How one extra language's speech ended. `failed` is an extra that threw: it is
 * logged and dropped, never reported to the client as the turn's failure.
 */
export type ExtraLanguageDelivery = ClauseDelivery | { stoppedBy: 'failed' };

export interface MultiLanguageSpeechDeps {
  /** The plan's `spoken` language: the one the turn is measured and judged by. */
  primary: LanguageCode;
  /** Every other voiced language. */
  extras: readonly LanguageCode[];
  /**
   * Speak the turn in one language. `onFirstAudio` must be called once that
   * language's first audio is on the wire; calling it again is harmless.
   */
  speakIn: (
    language: LanguageCode,
    isPrimary: boolean,
    onFirstAudio: () => void,
  ) => Promise<ClauseDelivery>;
  /** An extra threw. Called once per failed extra, for the log. */
  onExtraFailed: (language: LanguageCode, err: unknown) => void;
}

/**
 * Speak one turn in several languages: the primary first, the extras behind it.
 *
 * An extra starts only once the primary's first audio is out, or once the
 * primary has ended without any. The en and zh voices share one engine that
 * serializes per clause, so an extra started alongside would put its first
 * clause ahead of the primary listener's — the primary's latency is the one the
 * turn is measured by.
 *
 * An extra never fails the turn: a throw is caught here, logged through
 * `onExtraFailed` and dropped, and its `engine_busy` or `unsupported_audio` is
 * ignored. The only extra outcome that counts is `client_gone`, because a
 * client that left mid-extra has left the whole turn. A primary that throws
 * still throws, exactly as a single-language turn does; the extras then stop on
 * their own at their next "is the turn still held" check.
 */
export async function speakEveryLanguage(
  deps: MultiLanguageSpeechDeps,
): Promise<ClauseDelivery> {
  let releaseExtras!: () => void;
  const primaryStarted = new Promise<void>((done) => (releaseExtras = done));
  const primary = deps.speakIn(deps.primary, true, releaseExtras);
  // However the primary ends, so a primary with no audio cannot hold the
  // extras forever. Both callbacks, so this chain never rejects unhandled.
  primary.then(releaseExtras, releaseExtras);

  const extras = deps.extras.map((language) =>
    primaryStarted
      .then(() => deps.speakIn(language, false, () => undefined))
      .catch((err: unknown): ExtraLanguageDelivery => {
        deps.onExtraFailed(language, err);
        return { stoppedBy: 'failed' };
      }),
  );

  const delivery = await primary;
  return mergeLanguageDeliveries(delivery, await Promise.all(extras));
}

/**
 * The turn's delivery from its languages': the primary's, unless the client
 * left while an extra was still speaking.
 */
export function mergeLanguageDeliveries(
  primary: ClauseDelivery,
  extras: readonly ExtraLanguageDelivery[],
): ClauseDelivery {
  return extras.some((extra) => extra.stoppedBy === 'client_gone')
    ? { ...primary, stoppedBy: 'client_gone' }
    : primary;
}
