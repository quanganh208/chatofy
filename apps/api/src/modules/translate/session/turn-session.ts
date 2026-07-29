import { randomUUID } from 'node:crypto';
import type {
  AudioFrame,
  SessionOptions,
  TranscriptSegment,
  TranslationDirection,
  VoiceGender,
} from '@chatofy/types';
import { PartialTranscriptScheduler } from '../audio/partial-transcript-scheduler';
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
  private audio: TurnAudio | null = null;
  /** Last accepted inbound sequence, to catch replays and reordering. */
  private lastSequence = -1;
  private outboundSequence = 0;
  private readonly speculation = new TurnSpeculation();

  readonly direction: TranslationDirection;
  /** Which voice speaks this turn's translation, for every clause of it. */
  readonly voiceGender: VoiceGender;

  // Takes the whole options object so the caller has one thing to pass, but
  // keeps the settings flat internally — everything below reads `this.direction`
  // directly, and an options bag would only add a hop.
  constructor(options: SessionOptions) {
    this.direction = options.direction;
    this.voiceGender = options.voiceGender;
  }

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
