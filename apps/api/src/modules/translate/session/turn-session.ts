import { randomUUID } from 'node:crypto';
import type {
  AudioFrame,
  SessionOptions,
  TranscriptSegment,
  TranslationDirection,
  VoiceGender,
} from '@chatofy/types';
import { PartialTranscriptScheduler } from '../audio/partial-transcript-scheduler';
import type {
  CommitStats,
  StablePrefixCommitter,
} from '../audio/stable-prefix-commit';
import { LiveTranslationTrigger } from '../audio/live-translation-trigger';
import type { TranslatedTurnText } from '../services/pipeline-translator.service';
import { MAX_TURN_SECONDS, TurnAudio } from './turn-audio';
import { TurnSpeculation } from './turn-speculation';

/** Where a connection is in the turn it is currently taking. */
type TurnPhase = 'listening' | 'translating';

/**
 * Why a frame was refused, in the shape the wire needs.
 *
 * `closesTurn` is the difference between "that frame was no good" and "this
 * turn is over": only the length cap sets it, and the caller must answer it by
 * dropping the turn as well as reporting it.
 */
export interface FrameRejection {
  code: string;
  message: string;
  closesTurn?: boolean;
}

/** One turn of speech: what has been heard, and what may still be done to it. */
export class TurnSession {
  readonly sessionId = randomUUID();
  /** Paces the live transcript for this turn. */
  readonly partials = new PartialTranscriptScheduler();
  /** Decides when this turn is worth translating before it ends. */
  readonly liveTranslation = new LiveTranslationTrigger();

  private phase: TurnPhase = 'listening';
  /**
   * When this turn last showed a sign of a client being there.
   *
   * Read by the idle sweep, which is what stops an abandoned turn holding a slice of
   * the global concurrency ceiling for the lifetime of a connection.
   */
  private lastActivityAt = Date.now();
  private audio: TurnAudio | null = null;
  /** Last accepted inbound sequence, to catch replays and reordering. */
  private lastSequence = -1;
  private outboundSequence = 0;
  private readonly speculation = new TurnSpeculation();

  readonly direction: TranslationDirection;
  /** Which voice speaks this turn's translation, for every clause of it. */
  readonly voiceGender: VoiceGender;
  /**
   * Whether settled clauses are spoken while the speaker is still talking.
   *
   * Fixed for the turn's life. A turn cannot start speaking mid-sentence
   * halfway through, because everything downstream — what `end()` still owes,
   * what the client has already heard — is decided by which mode the turn began
   * in.
   */
  readonly streaming: boolean;

  /**
   * What this turn has already said out loud, clause by clause.
   *
   * Kept on the session rather than in the driver for the same reason the
   * partial scheduler is: the driver runs once per arriving frame and holds
   * nothing between calls, so anything that must survive from one frame to the
   * next belongs here. Also the record `end()` reads to work out what it still
   * owes, and what the continuation prompt must not contradict.
   */
  private readonly spokenClauses: string[] = [];
  /**
   * When each clause was spoken, as ms since this turn opened.
   *
   * The measurement the whole feature is judged on is how soon the listener
   * hears anything, and that happens BEFORE the endpoint every other timing on
   * this turn is measured from. So these are relative to the turn's start, which
   * is the only origin that exists yet when the first clause goes out.
   */
  private readonly spokenAtMs: number[] = [];
  /** The turn's commit policy; see {@link committer}. */
  private commitPolicy: StablePrefixCommitter | null = null;

  /** When this turn opened; the origin for mid-turn timings. */
  readonly startedAt = Date.now();

  // Takes the whole options object so the caller has one thing to pass, but
  // keeps the settings flat internally — everything below reads `this.direction`
  // directly, and an options bag would only add a hop.
  //
  // `turnId` sits beside the options rather than inside them. The gateway
  // destructures the options and rebuilds the object it passes down, so widening
  // `sessionOptionsSchema` would pull the id through six more places that have no
  // use for it — and it is not a translation setting.
  constructor(
    options: SessionOptions,
    /**
     * The client's own name for this turn, echoed on every event about it. Absent
     * when the client did not send one; see `turnIdSchema` in the contract.
     */
    readonly turnId?: string,
  ) {
    this.direction = options.direction;
    this.voiceGender = options.voiceGender;
    this.streaming = options.streaming;
  }

  /**
   * The clauses already spoken, in order. Empty until the first commit.
   *
   * A copy, because a caller holding the live array would see it grow under
   * them mid-request — and the one caller that matters is building a prompt
   * that says "this text cannot change".
   */
  get spoken(): string[] {
    return [...this.spokenClauses];
  }

  /** How many clauses have been spoken; also the `seq` of the next one. */
  get spokenCount(): number {
    return this.spokenClauses.length;
  }

  /** Record a clause as spoken. Append-only: audio does not come back. */
  recordSpokenClause(text: string, now = Date.now()): void {
    this.spokenClauses.push(text);
    this.spokenAtMs.push(now - this.startedAt);
  }

  /** When each clause was spoken, ms after this turn opened. */
  get spokenTimings(): number[] {
    return [...this.spokenAtMs];
  }

  /**
   * The commit policy for this turn, built once on first use.
   *
   * Held here rather than in the driver because the driver is called once per
   * arriving frame and keeps nothing between calls, while the policy's whole job
   * is to remember what it has already released. Built lazily through a factory
   * so this file does not have to know how the policy is configured — that
   * belongs to the caller that knows the turn's language.
   */
  committer(build: () => StablePrefixCommitter): StablePrefixCommitter {
    this.commitPolicy ??= build();
    return this.commitPolicy;
  }

  /**
   * What the commit policy has seen, or null on a turn that never streamed.
   *
   * `contradictions` is the number that decides whether this feature is sound:
   * a word already spoken aloud that a later read disagreed with. It is reported
   * rather than acted on, because the audio is already gone.
   */
  commitStats(): CommitStats | null {
    return this.commitPolicy?.getStats() ?? null;
  }

  get isListening(): boolean {
    return this.phase === 'listening';
  }

  get isTranslating(): boolean {
    return this.phase === 'translating';
  }

  /**
   * How long since this turn last heard from its client, in milliseconds.
   *
   * `now` is passed in so a sweep measures every turn against one instant, and so a
   * spec can decide what time it is.
   */
  idleMs(now: number): number {
    return now - this.lastActivityAt;
  }

  /** Note that the client is still there. */
  touch(now = Date.now()): void {
    this.lastActivityAt = now;
  }

  /** The turn's audio, or null while no frame has fixed a sample rate. */
  get buffered(): TurnAudio | null {
    return this.audio;
  }

  get speculationCount(): number {
    return this.speculation.count;
  }

  /**
   * Which side of the conversation is speaking.
   *
   * A turn is only ever spoken by the side whose language it translates away
   * from, so the direction says who it is.
   */
  get speakerRole(): 'speaker_a' | 'speaker_b' {
    return this.direction === 'vi_to_en' ? 'speaker_a' : 'speaker_b';
  }

  /**
   * Take one inbound frame, or say why not.
   *
   * Every rule that can refuse a frame lives here except "no turn is open",
   * which the caller answers because there is no turn to ask.
   */
  acceptFrame(frame: AudioFrame): FrameRejection | null {
    if (!this.isListening) {
      return {
        code: 'session_busy',
        message: 'The turn is already being translated',
      };
    }
    // Kept deliberately, and not redundant despite appearances: the caller now
    // looks the turn up by this same id, so this comparison can only fail when a
    // caller hands a frame to the wrong turn. That is exactly the failure worth
    // catching — audio silently appended to a neighbouring turn corrupts an
    // utterance and reports nothing. Do not remove it as duplication.
    if (frame.sessionId !== this.sessionId) {
      return {
        code: 'frame_rejected',
        message: 'Frame belongs to another session',
      };
    }
    if (frame.encoding !== 'pcm16') {
      return {
        code: 'unsupported_audio',
        message: `Unsupported frame encoding ${frame.encoding}; this path expects pcm16`,
      };
    }
    // Gaps are legitimate — a client gating on voice activity only sends while
    // someone is speaking. A sequence that does not advance is not: it means a
    // replayed or reordered frame, which would corrupt the utterance.
    if (frame.sequence <= this.lastSequence) {
      return {
        code: 'frame_rejected',
        message: 'Frame sequence did not advance',
      };
    }

    this.audio ??= new TurnAudio(frame.sampleRate);
    if (frame.sampleRate !== this.audio.sampleRate) {
      return {
        code: 'frame_rejected',
        message: `Frame sample rate ${frame.sampleRate} differs from the turn's ${this.audio.sampleRate}`,
      };
    }

    const chunk = Buffer.from(frame.payload, 'base64');
    if (this.audio.wouldExceedCap(chunk.length)) {
      return {
        code: 'turn_too_long',
        message: `A turn may not exceed ${MAX_TURN_SECONDS}s of audio`,
        closesTurn: true,
      };
    }

    this.audio.append(chunk);
    this.lastSequence = frame.sequence;
    this.touch();
    return null;
  }

  beginTranslating(): void {
    this.phase = 'translating';
  }

  nextOutboundSequence(): number {
    return this.outboundSequence++;
  }

  /**
   * Whether another guess is worth making.
   *
   * The caller still has to hold the audio to build one, so this answers the
   * policy question only.
   */
  canSpeculate(): boolean {
    if (!this.isListening) return false;
    if (!this.audio || this.audio.isEmpty) return false;
    return this.speculation.canRenew(this.audio.byteLength);
  }

  startSpeculation(atBytes: number, work: Promise<TranslatedTurnText>): void {
    this.speculation.start(atBytes, work);
  }

  /** The guess the endpoint may still reuse, if there is one. */
  usableSpeculation(): Promise<TranslatedTurnText> | null {
    if (!this.audio) return null;
    return this.speculation.usable(this.audio.byteLength);
  }

  toSegment(sourceText: string, targetText: string): TranscriptSegment {
    return {
      id: randomUUID(),
      sessionId: this.sessionId,
      speakerRole: this.speakerRole,
      direction: this.direction,
      sourceText,
      targetText,
      // Audio travels over this socket rather than being stored.
      audioUrl: null,
      createdAt: new Date().toISOString(),
    };
  }
}
