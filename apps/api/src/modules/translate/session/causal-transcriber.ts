import type { Logger } from '@nestjs/common';
import type { SttStreamSession } from '@chatofy/ai-providers';
import type { PipelineTranslatorService } from '../services/pipeline-translator.service';
import type { TurnSession } from './turn-session';

/**
 * The rate the streaming route decodes at, with no header to say otherwise.
 *
 * Not negotiable and not inferred: `/stream/{id}/feed` takes bare PCM, so
 * nothing in the payload carries a rate. A turn at any other rate is refused the
 * causal path rather than resampled here, because resampling is the sidecar's
 * job everywhere else and a second implementation would be a second thing to be
 * wrong.
 */
const CAUSAL_SAMPLE_RATE = 16000;

/**
 * The transcript minus its last word, which the decoder may still be spelling.
 *
 * The decoder emits PIECES, not words. Measured on a real turn, the running
 * text went `"n"` -> `"nó"`, `"là"` -> `"làm"`, `"d"` -> `"dân"` — every one of
 * those a word that had already been handed to the commit policy, and with
 * `AGREEMENT_DEPTH_VI = 1` already spoken. Appending deltas makes the STRING
 * monotone by construction and says nothing at all about the WORDS, which are
 * the unit that gets synthesized.
 *
 * So the last word is withheld until whitespace proves it finished. That cost
 * is one feed of latency — the next chunk either extends the word or starts the
 * next one — and it buys the property the whole path is built on.
 *
 * Whitespace only, deliberately, though punctuation would also imply a finished
 * word: a rule with one condition is one that stays true. The saving would be a
 * fraction of one feed at a clause boundary.
 *
 * Monotone as required: the transcript only ever grows at its end, so the
 * position of its last space never moves backwards.
 */
export function settledPrefix(text: string): string {
  for (let i = text.length - 1; i >= 0; i -= 1) {
    if (/\s/.test(text.charAt(i))) return text.slice(0, i);
  }
  // Nothing has finished yet: one unfinished word is not a transcript.
  return '';
}

/**
 * One turn's running transcript, built from audio read exactly once.
 *
 * This is what the commit path was always described as reading and never did.
 * The design claims — in `stable-prefix-commit.ts` and in the engine that was
 * chosen for it — that Vietnamese text is append-only because the decoder is
 * causal. That is true of the decoder and was not true of the system: the only
 * route to the recognizer decoded whole utterances, so the running transcript
 * came from re-reading a growing window, which can revise anything. The engine's
 * accuracy cost was paid and none of its behaviour was received.
 *
 * Two properties follow from reading each frame once, and both matter more than
 * the accuracy they cost:
 *
 *   append-only  a word this returns is a word the decoder has committed. The
 *                clause built from it can be spoken before the next chunk
 *                arrives, which is the entire feature.
 *   flat cost    a 45s turn costs what a 5s turn costs per second of audio. The
 *                window re-read did not: every tick decoded the last 8 seconds
 *                again, so a long turn spent several cores on audio it had
 *                already understood.
 *
 * Degrades to nothing rather than to something worse. A backend with no causal
 * session — English today, or Vietnamese after a rollback — leaves this inert,
 * `text` stays empty, no clause is ever committed, and the turn is answered at
 * its endpoint exactly as it was before this path existed.
 */
export class CausalTranscriber {
  private stream: SttStreamSession | null = null;
  private opening: Promise<void> | null = null;
  /** Set once the backend has refused; asking again every 20ms would be rude. */
  private unavailable = false;
  /** A session that failed but is still open on the sidecar; see {@link close}. */
  private doomed: SttStreamSession | null = null;
  private closed = false;
  private consumedBytes = 0;
  /**
   * The feed currently in flight, so later calls can queue behind it.
   *
   * A promise rather than a boolean, because `finalize` and `close` must WAIT
   * rather than decline. `end()` normally arrives a frame after the last feed
   * was dispatched, so without this the tail is flushed while a chunk is still
   * being consumed — and the sidecar's per-session lock serializes those two
   * without preserving the order they were sent in. The tail would then land
   * before the audio that precedes it.
   */
  private inFlight: Promise<unknown> | null = null;
  private running = '';
  /**
   * Whether this turn has ever had a causal decoder.
   *
   * Latched, and it outlives {@link active} on purpose. If a feed fails
   * mid-turn the causal source is gone but its words have already been spoken,
   * so the commit policy still holds nemotron tokens — and the re-read path
   * must NOT step in, because committing zipformer's wording against them is
   * the two-transcripts-of-one-utterance failure the policy cannot survive.
   * After a failure this turn commits nothing more and is answered at its
   * endpoint.
   */
  private everActive = false;

  constructor(
    private readonly pipeline: PipelineTranslatorService,
    private readonly logger: Logger,
  ) {}

  /** Everything the decoder has committed for this turn so far. */
  get text(): string {
    return this.running;
  }

  /** True while this turn actually has a causal decoder behind it. */
  get active(): boolean {
    return this.stream !== null;
  }

  /** True once a causal decoder has fed this turn, even if it later failed. */
  get everFed(): boolean {
    return this.everActive;
  }

  /**
   * Whether it is settled which recognizer feeds this turn's commit policy.
   *
   * Opening a session is a round trip, so for the first frames the answer is
   * neither yes nor no. That gap matters: English has no causal session and its
   * commits legitimately come from the re-read path instead, but a turn that
   * committed from BOTH sources would hand the policy two different transcripts
   * of the same audio and manufacture exactly the contradictions the policy
   * exists to prevent. So the other source waits for this to settle rather than
   * guessing, which costs one round trip of commits on a path that needs several
   * words before it can commit anything anyway.
   */
  get decided(): boolean {
    return this.stream !== null || this.unavailable;
  }

  /**
   * Hand the decoder whatever audio it has not seen, and report the new total.
   *
   * Resolves to null when nothing changed — no session, nothing new, or a feed
   * already running. That last one is not a dropped frame: the offset is what
   * decides what gets sent, so bytes that arrive during a feed are simply picked
   * up by the next one. Overlapping feeds would be the real loss, because they
   * would reach the decoder out of order.
   */
  onAudio(session: TurnSession): Promise<string | null> {
    if (this.closed || this.unavailable || this.inFlight) {
      return Promise.resolve(null);
    }
    // Claimed SYNCHRONOUSLY, before the first await. Assigning it inside the
    // async body left a microtask in which `finalize` saw nothing in flight and
    // flushed the tail ahead of the chunk it belongs after — which is the exact
    // ordering this field exists to prevent, and it looked fine until a test
    // asked for the two in the same tick.
    const work = this.readAudio(session);
    this.inFlight = work;
    void work.finally(() => {
      if (this.inFlight === work) this.inFlight = null;
    });
    return work;
  }

  private async readAudio(session: TurnSession): Promise<string | null> {
    await this.ensureOpen(session);
    const stream = this.stream;
    if (!stream) return null;

    const audio = session.buffered;
    if (!audio || audio.byteLength <= this.consumedBytes) return null;
    if (audio.sampleRate !== CAUSAL_SAMPLE_RATE) {
      // The streaming route takes raw PCM with no header, so the rate travels
      // only by assumption — and the contract accepts 8000–48000. A 48 kHz
      // client would be decoded at three times speed and SPOKEN. `/transcribe`
      // is safe from this because its WAV carries the rate.
      this.fail(
        'feed',
        new Error(
          `causal decoding needs ${CAUSAL_SAMPLE_RATE}Hz, turn is ${audio.sampleRate}Hz`,
        ),
      );
      return null;
    }

    const chunk = audio.pcmFrom(this.consumedBytes);
    if (chunk.length === 0) return null;

    try {
      const delta = await stream.feed(chunk);
      // Advanced only after the feed resolved. The offset is what decides what
      // gets sent next, so advancing it for audio the decoder did not receive
      // would open a gap it can never learn about — it does not re-read.
      this.consumedBytes += chunk.length;
      if (!delta) return null;
      this.running += delta;
      // The settled part only, never the running text: the word at its end is
      // still being spelled, and this return value is spoken. `finalize` is
      // where the last word is released, because by then nothing follows it.
      const settled = settledPrefix(this.running);
      return settled === '' ? null : settled;
    } catch (err) {
      // Deliberately NOT retried with the next chunk. A feed that failed
      // client-side may still have been consumed server-side, so resending it
      // would deliver the same audio twice — which for a causal decoder is
      // corruption, not a second chance. The turn gives up the causal path and
      // is answered at its endpoint.
      this.fail('feed', err);
      return null;
    }
  }

  /**
   * Flush the decoder's tail once the speaker has stopped.
   *
   * Returns the complete transcript, tail included. Safe on a turn that never
   * had a session: it returns the empty string, and the caller falls back to
   * whatever the endpoint decode produced.
   */
  async finalize(): Promise<string> {
    // Behind any feed still in flight, so the tail cannot overtake the audio it
    // is the tail OF.
    await this.settle();
    if (!this.stream || this.closed) return this.running;
    try {
      this.running += await this.stream.finalize();
    } catch (err) {
      this.fail('finalize', err);
    }
    return this.running;
  }

  /**
   * Release the backend's state.
   *
   * Called from every path a turn can leave by, including the ones that are
   * already failing — a session that outlives its turn holds decoder state on
   * the sidecar until a reaper notices, and a socket that drops mid-sentence
   * takes exactly that path.
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.settle();
    // `doomed` rather than `stream`, because a failed feed nulls `stream` while
    // the session it opened is still alive on the sidecar. Dropping it here
    // would leave 60MB for the reaper to collect thirty seconds later and log
    // as a vanished client — a signal that is supposed to mean something else.
    const stream = this.stream ?? this.doomed;
    this.stream = null;
    this.doomed = null;
    if (!stream) return;
    try {
      await stream.close();
    } catch (err) {
      this.logger.warn(
        `causal transcript close failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /** Wait out a feed in flight, ignoring how it went. */
  private async settle(): Promise<void> {
    const feed = this.inFlight;
    if (!feed) return;
    await feed.catch(() => {});
  }

  private async ensureOpen(session: TurnSession): Promise<void> {
    if (this.stream || this.unavailable) return;
    // Shared rather than re-entered: frames arrive faster than a round trip, so
    // without this a turn would open several sessions and keep only the last —
    // the others left holding decoder state nobody would ever close.
    this.opening ??= this.open(session);
    await this.opening;
  }

  private async open(session: TurnSession): Promise<void> {
    const stream = await this.pipeline.openTranscriptStream(session.direction);
    if (!stream) {
      this.unavailable = true;
      return;
    }
    // The turn may have ended while the session was being opened. Closing it
    // here rather than adopting it is the difference between a tidy no-op and a
    // leak nothing will ever come back for.
    if (this.closed) {
      void stream.close().catch(() => {});
      return;
    }
    this.stream = stream;
    this.everActive = true;
  }

  /**
   * Give up on the causal path for this turn, loudly enough to be found.
   *
   * Not silent, unlike the live transcript's failures: this one changes what the
   * listener hears. The turn still gets its endpoint translation, so nothing is
   * lost that the user can see — but a transcript that stops growing while the
   * speaker keeps talking is precisely the symptom that is impossible to
   * diagnose without this line.
   */
  private fail(stage: string, err: unknown): void {
    this.unavailable = true;
    // Kept so `close` can still release it. The session is alive on the sidecar
    // whatever went wrong on this side of the wire.
    this.doomed = this.stream;
    this.stream = null;
    this.logger.warn(
      `causal transcript ${stage} failed, turn falls back to endpoint decoding: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}
