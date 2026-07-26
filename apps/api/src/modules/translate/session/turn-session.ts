import { randomUUID } from 'node:crypto';
import type {
  AudioFrame,
  TranscriptSegment,
  TranslationDirection,
} from '@chatofy/types';
import { PartialTranscriptScheduler } from '../audio/partial-transcript-scheduler';
import { LiveTranslationTrigger } from '../audio/live-translation-trigger';
import type { TranslatedTurnText } from '../services/pipeline-translator.service';
import { MAX_SPECULATIONS_PER_TURN } from './translation-model-policy';
import { MAX_TURN_SECONDS, TurnAudio } from './turn-audio';

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

/**
 * Transcription and translation started on a suspected end of speech, before
 * the endpoint was confirmed.
 */
interface Speculation {
  /** Bytes buffered when it started; if the turn grew, the work is stale. */
  atBytes: number;
  work: Promise<TranslatedTurnText>;
}

/** One turn of speech: what has been heard, and what may still be done to it. */
export class TurnSession {
  readonly sessionId = randomUUID();
  /** Paces the live transcript for this turn. */
  readonly partials = new PartialTranscriptScheduler();
  /** Decides when this turn is worth translating before it ends. */
  readonly liveTranslation = new LiveTranslationTrigger();

  private phase: TurnPhase = 'listening';
  private audio: TurnAudio | null = null;
  /** Last accepted inbound sequence, to catch replays and reordering. */
  private lastSequence = -1;
  private outboundSequence = 0;
  /** The most recent guess; earlier ones are superseded and dropped. */
  private speculation: Speculation | null = null;
  /** How many guesses this turn has spent, against the cap. */
  private speculations = 0;

  constructor(readonly direction: TranslationDirection) {}

  get isListening(): boolean {
    return this.phase === 'listening';
  }

  get isTranslating(): boolean {
    return this.phase === 'translating';
  }

  /** The turn's audio, or null while no frame has fixed a sample rate. */
  get buffered(): TurnAudio | null {
    return this.audio;
  }

  get speculationCount(): number {
    return this.speculations;
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
    // Nothing new to transcribe: a second guess over identical audio would buy
    // an identical answer for another request.
    if (this.speculation?.atBytes === this.audio.byteLength) return false;
    // A client that suspects the end constantly must not be able to spend the
    // quota of one that talks normally.
    return this.speculations < MAX_SPECULATIONS_PER_TURN;
  }

  startSpeculation(atBytes: number, work: Promise<TranslatedTurnText>): void {
    // A speculation the endpoint never confirms is thrown away unawaited, and
    // an unobserved rejection would take the process down. This matters more
    // now than it did: every guess but the last is discarded by design.
    //
    // Attached here rather than left to the caller: the cost of forgetting it
    // is the whole process, and this way there is nothing to forget.
    work.catch(() => undefined);

    // The superseded guess is dropped rather than cancelled — the pipeline has
    // no cancellation, so its cost is already spent either way.
    this.speculation = { atBytes, work };
    this.speculations += 1;
  }

  /** The guess the endpoint may still reuse, if there is one. */
  usableSpeculation(): Promise<TranslatedTurnText> | null {
    // A speculation is only usable if no further audio arrived after it
    // started — otherwise it transcribed a different utterance to the one
    // being ended.
    if (!this.speculation) return null;
    if (this.speculation.atBytes !== this.audio?.byteLength) return null;
    return this.speculation.work;
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
