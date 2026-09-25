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
    if (!session.partials.shouldStart(audio.byteLength, audio.bytesPerSecond)) {
      return;
    }

    const atBytes = audio.byteLength;
    session.partials.markStarted(atBytes);

    void this.pipeline
      .transcribe({
        audio: audio.toWav(
          session.partials.windowStart(atBytes, audio.bytesPerSecond),
        ),
        mimeType: 'audio/wav',
        direction: session.direction,
        // Passed for the recognizer's sake, the same way this call already
        // passes them for the translator's further down: a preview that heard a
        // proper noun differently from the settled transcript would correct
        // itself on screen for no reason the reader can see.
        hints: session.hints,
        // A re-read every 300ms needs the cheap recognizer; the settled
        // transcript at turn end is what gets the best one.
        pass: 'partial',
      })
      .then((text) => {
        // Checked here, not only before starting: the turn may have ended, or
        // the client left, while this was decoding.
        if (!stillCurrent()) return;
        if (!session.isListening) return;
        if (!session.partials.shouldEmit(atBytes)) return;
        if (!text.trim()) return;

        session.partials.markEmitted(atBytes);
        // One read produces ONE event. A client that asked for settled text is
        // sent the delta instead of this, never both: they describe the same
        // read, and on a turn's FIRST read they disagree about it. The delta
        // says nothing has settled yet; `partial` carries no settled marker at
        // all, and a client reading an absent marker as "the whole line is
        // settled" — which is what keeps an un-upgraded client working — then
        // draws the opening words in settled colour for one frame before the
        // delta corrects them.
        //
        // That frame was measured once per turn on a 16-turn session, and it is
        // the only thing sending both ever produced: from the second read on,
        // the client discards `partial` outright.
        if (!session.streamCommitted) {
          channel.emit({
            type: 'server.transcript.partial',
            sessionId: session.sessionId,
            text,
            speaker: session.speakerRole,
            direction: session.direction,
          });
        }
        this.settleTranscript(
          session,
          channel,
          text,
          atBytes,
          audio.bytesPerSecond,
        );
        this.translateLive(session, channel, stillCurrent);
      })
      .catch((err: unknown) => {
        this.logger.debug(
          `partial read failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      })
      .finally(() => session.partials.markSettled());
  }

  /**
   * Advances this turn's settled transcript, and tells the client about it when
   * the client asked to be told.
   *
   * Settling happens for EVERY turn, not only for a client that opted in. The
   * settled text is server-side state that the live-translation trigger reads to
   * decide when a sentence is worth translating early; gating the update on the
   * wire flag would leave that text permanently empty for every client that has
   * not shipped support yet — extension and mobile among them — and silently
   * take their mid-turn translations away. The flag decides what is SENT, never
   * what is computed.
   *
   * What it sends is the whole of what this read produced, which is why the
   * caller sends `server.transcript.partial` only when the flag is off. An
   * opted-in client gets `committed + pending` here and needs nothing else.
   */
  private settleTranscript(
    session: TurnSession,
    channel: EventChannel,
    text: string,
    atBytes: number,
    bytesPerSecond: number,
  ): void {
    // Settling compares each read against the one before it, which only means
    // something while both describe the same stretch of audio. Once the buffer
    // outgrows the window, the window slides, the two reads no longer start at
    // the same instant, and a shared prefix stops being evidence of anything.
    //
    // A web turn cannot reach here — the client cuts at 8s and the window is 9 —
    // so this is for a client with no such ceiling. For that client the line
    // simply never settles, which is exactly today's behaviour.
    const windowed = atBytes <= session.partials.windowSeconds * bytesPerSecond;
    if (windowed) session.committer.push(text);

    if (!session.streamCommitted) return;
    channel.emit({
      type: 'server.transcript.delta',
      sessionId: session.sessionId,
      // Past the window the whole line is a guess, expressed through the new
      // event rather than by falling back to `partial` — an opted-in client
      // ignores `partial` once it has been given settled text.
      committed: windowed ? session.committer.committed : '',
      pending: windowed ? session.committer.pending : text,
      reanchors: session.committer.reanchors,
      speaker: session.speakerRole,
      direction: session.direction,
    });
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
  ): void {
    // ONE string, used for the decision, the bookkeeping and the request alike.
    // Deciding on settled text and then sending the raw reading would translate
    // the tail that is still moving, and would leave the two measured in
    // different units — which silently kills the character rule after one fire.
    const committed = session.committer.committed;
    const { reanchors } = session.committer;
    if (!session.liveTranslation.shouldTranslate(committed, reanchors)) return;

    session.liveTranslation.markStarted(committed, reanchors);

    // Taken BEFORE the request so every piece it produces carries the same
    // label, and so the label already differs from the previous translation's
    // by the time the first piece can arrive.
    let generation = session.nextTranslationGeneration();
    // Whether anything of this translation reached the screen, which decides
    // whether a translation that turns out to describe retracted words has to
    // be taken back or merely dropped.
    let shown = false;

    void this.pipeline
      .translate({
        text: committed,
        direction: session.direction,
        models: LIVE_TRANSLATION_MODELS,
        onChunk: (delta, restart) => {
          // Behind the same opt-in as the settled transcript, and for the same
          // reason: a client parses server events against a strict union and
          // reports an unknown one as an error to the user. A tab opened before
          // these events existed would show that error on every piece of every
          // translation. The flag is the one thing that says a client is
          // running code that knows about them, which is why it gates both.
          if (!session.streamCommitted) return;
          // Checked inside the callback, not once around it: a turn can end
          // while its translation is still being written, and every guard the
          // finished answer gets applies just as much to the pieces.
          if (!stillCurrent()) return;
          if (!session.isListening) return;
          // The provider gave up on one attempt and started another, so what
          // the client is showing belongs to the attempt that failed. A new
          // label is what tells it to drop that rather than grow it.
          if (restart && generation === session.currentTranslationGeneration) {
            generation = session.nextTranslationGeneration();
          }
          shown = true;
          channel.emit({
            type: 'server.translation.delta',
            sessionId: session.sessionId,
            delta,
            generation,
            direction: session.direction,
          });
        },
        // The on-screen preview is hinted like every other path. Leaving it out
        // would make the preview and the spoken translation disagree on proper
        // nouns for the length of a turn, which reads as the system changing
        // its mind rather than as one of them being unhinted.
        hints: session.hints,
      })
      .then((text) => {
        if (!stillCurrent()) return;
        // The finished translation has replaced this on screen already; putting
        // a guess back under it would read as the app losing the answer.
        if (!session.isListening) return;
        // A correction can land while this request is in the air, and then this
        // answer describes a sentence that has since been taken back. Showing it
        // would put a translation of retracted words on screen — the one way a
        // wrong prefix outlives the correction that fixed it.
        if (!session.committer.committed.startsWith(committed)) {
          // Refusing to show the finished text is not enough on its own once
          // the pieces of it have already been shown: those describe the SAME
          // retracted sentence, and nothing about them expires. Withdraw them
          // with an empty piece under a fresh label, which is how this protocol
          // already says "what you are showing belongs to something abandoned".
          //
          // The next translation would eventually do the same — the correction
          // that fired this guard also opens the trigger — but "eventually" is
          // one Gemini round-trip away, and until then the screen holds words
          // that were taken back.
          if (shown) {
            channel.emit({
              type: 'server.translation.delta',
              sessionId: session.sessionId,
              delta: '',
              generation: session.nextTranslationGeneration(),
              direction: session.direction,
            });
          }
          return;
        }

        channel.emit({
          type: 'server.translation.partial',
          sessionId: session.sessionId,
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
