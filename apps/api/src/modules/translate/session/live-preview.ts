import type { Logger } from '@nestjs/common';
import type { PipelineTranslatorService } from '../services/pipeline-translator.service';
import type { EventChannel } from './event-channel';
import { LIVE_TRANSLATION_MODELS } from './translation-model-policy';
import type { TurnSession } from './turn-session';

/** True while the turn this work started on is still the socket's turn. */
type StillCurrent = () => boolean;

/**
 * What a speaker sees while they are still speaking: the running transcript,
 * and — on a long enough turn — a provisional translation of it.
 *
 * Both halves are fire-and-forget and both fail silently, which is what makes
 * them one class. What they do NOT share is the test for whether an answer that
 * has come back is still worth showing; see {@link translateLive}.
 */
export class LivePreview {
  constructor(
    private readonly pipeline: PipelineTranslatorService,
    private readonly logger: Logger,
  ) {}

  /**
   * Re-read the turn so far and push what the speaker has said to their screen.
   *
   * Driven by arriving audio rather than by a timer, which is why nothing here
   * needs tearing down. A client that closes its tab mid-sentence stops sending
   * frames, so the reading stops by itself; a timer would have kept decoding a
   * dead session's buffer until someone remembered to cancel it.
   *
   * Failure is swallowed on purpose. A live transcript is a courtesy — the turn
   * is answered by `end()` regardless — so a recogniser that stumbles here must
   * not put an error in front of someone who is still talking, and an
   * unobserved rejection would take the process down.
   */
  onAudio(
    session: TurnSession,
    channel: EventChannel,
    stillCurrent: StillCurrent,
  ): void {
    const audio = session.buffered;
    if (!audio) return;
    if (!session.partials.shouldStart(audio.byteLength)) return;

    const atBytes = audio.byteLength;
    session.partials.markStarted(atBytes);

    void this.pipeline
      .transcribe({
        audio: audio.toWav(
          session.partials.windowStart(atBytes, audio.bytesPerSecond),
        ),
        mimeType: 'audio/wav',
        direction: session.direction,
      })
      .then((text) => {
        // Checked here, not only before starting: the turn may have ended, or
        // the client left, while this was decoding.
        if (!stillCurrent()) return;
        if (!session.isListening) return;
        if (!session.partials.shouldEmit(atBytes)) return;
        if (!text.trim()) return;

        session.partials.markEmitted(atBytes);
        channel.emit({
          type: 'server.transcript.partial',
          text,
          speaker: session.speakerRole,
          direction: session.direction,
        });
        this.translateLive(
          session,
          channel,
          stillCurrent,
          text,
          audio.secondsAt(atBytes),
        );
      })
      .catch((err: unknown) => {
        this.logger.debug(
          `partial read failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      })
      .finally(() => session.partials.markSettled());
  }

  /**
   * Translate a sentence that is still being spoken, if it is worth the request.
   *
   * Only the text is shown; no audio is ever synthesized from it. The sentence
   * is unfinished, so the translation is a guess that the rest of the speech can
   * overturn — and a guess can be quietly replaced on screen, while a guess
   * spoken aloud cannot be taken back.
   *
   * Fails silently for the same reason the live transcript does, with one
   * addition: its model has no fallback, so a rate limit here simply means the
   * live translation stops appearing while the turn itself is unaffected.
   *
   * The two guards below are deliberately NOT the four that guard the transcript
   * above, and the difference must not be factored into a shared helper. The
   * transcript calls `markEmitted(atBytes)` before handing control here, and
   * `shouldEmit(b)` asks `b > emittedAtBytes` — so reusing it would compare
   * `atBytes` against itself, refuse every provisional translation, and still
   * charge the turn for each request it had already spent.
   */
  private translateLive(
    session: TurnSession,
    channel: EventChannel,
    stillCurrent: StillCurrent,
    transcript: string,
    seconds: number,
  ): void {
    if (!session.liveTranslation.shouldTranslate(transcript, seconds)) return;

    session.liveTranslation.markStarted(transcript);

    void this.pipeline
      .translate({
        text: transcript,
        direction: session.direction,
        models: LIVE_TRANSLATION_MODELS,
      })
      .then((text) => {
        if (!stillCurrent()) return;
        // The finished translation has replaced this on screen already; putting
        // a guess back under it would read as the app losing the answer.
        if (!session.isListening) return;

        channel.emit({
          type: 'server.translation.partial',
          text,
          direction: session.direction,
        });
      })
      .catch((err: unknown) => {
        this.logger.debug(
          `live translation skipped: ${err instanceof Error ? err.message : String(err)}`,
        );
      })
      .finally(() => session.liveTranslation.markSettled());
  }
}
