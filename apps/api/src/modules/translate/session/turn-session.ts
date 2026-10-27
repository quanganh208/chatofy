import { randomUUID } from 'node:crypto';
import {
  AUTO_DETECT,
  speakerRoleFor,
  type AudioFrame,
  type SessionLanguagePair,
  type SessionOptions,
  type SpeakerRole,
  type TranscriptSegment,
  type LanguagePair,
  type LanguageCode,
  type TranslationHints,
  type VoiceGender,
} from '@chatofy/types';
import { PartialTranscriptScheduler } from '../audio/partial-transcript-scheduler';
import { LiveTranslationTrigger } from '../audio/live-translation-trigger';
import { TranslationBudget } from '../audio/translation-budget';
import { LIVE_TRANSLATION_MODELS } from './translation-model-policy';
import { StreamingCommitter } from '../audio/streaming-committer';
import type { TranslatedTurnText } from '../services/pipeline-translator.service';
import { MAX_TURN_SECONDS, TurnAudio } from './turn-audio';
import { TurnSpeculation } from './turn-speculation';
import { DeclaredLanguageIdentifier } from './language-identifier';
import {
  planForPair,
  type TurnLanguagePlan,
  type TranslationMap,
} from './turn-language-plan';
import { TurnLanguageDecision } from './turn-language-decision';

/**
 * The identifier behind `TurnSessionDeps.languages`'s default plan.
 *
 * One shared instance rather than one per turn: `DeclaredLanguageIdentifier`
 * holds no state, so there is nothing a fresh instance would buy.
 */
const DEFAULT_IDENTIFIER = new DeclaredLanguageIdentifier();

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
 * Ceiling a turn uses when nobody handed it a shared budget.
 *
 * High enough never to bind, because a turn built without a budget is a turn
 * built by a test: the point is that the real policy still runs, not that a
 * second code path exists.
 */
const UNMETERED_RPM = 10_000;

/** Threshold a turn uses when nobody configured one; mirrors the env default. */
const DEFAULT_COMMIT_CHARS = 15;

/** What a turn needs from the process to meter its mid-sentence translations. */
export interface TurnSessionDeps {
  budget?: TranslationBudget;
  /**
   * Newly settled characters worth a mid-sentence translation. A function for a
   * turn whose language is decided while it is spoken: the count belongs to the
   * language the settled text is in, which is only known once the turn locks.
   */
  commitChars?: number | ((language: LanguageCode) => number);
  userId?: string;
  /**
   * What the conversation had learned when this turn opened, for the live
   * preview's recognizer. The final decode reads the live set instead, so a
   * term learned while this turn was being spoken still reaches its final.
   */
  learnedTerms?: readonly string[];
  /**
   * The language plan this turn runs, already decided by the caller.
   *
   * `TranslationSessionService.start` builds it once — the same plan its
   * `language_unavailable` check read — and hands it here, so the turn can
   * never run a plan the refusal check did not see. Defaults to
   * `planForPair` with {@link DeclaredLanguageIdentifier}, in the same
   * spirit as `budget` above: a turn built without one still runs the real
   * derivation, just with the trivial identifier.
   */
  languages?: TurnLanguagePlan;
  /**
   * How this turn's language is decided, for a turn whose language is not
   * declared up front. Wins over {@link languages}, which becomes a decision
   * already made.
   */
  decision?: TurnLanguageDecision;
}

/**
 * Session options with the pair declared — what a turn built without a
 * {@link TurnSessionDeps.decision} runs, since only a decision can say what an
 * undeclared source turned out to be.
 */
export type DeclaredSessionOptions = Omit<SessionOptions, 'languagePair'> & {
  readonly languagePair: LanguagePair;
};

/** One turn of speech: what has been heard, and what may still be done to it. */
export class TurnSession {
  readonly sessionId = randomUUID();
  /** Paces the live transcript for this turn. */
  readonly partials = new PartialTranscriptScheduler();
  /** Decides when this turn is worth translating before it ends. */
  readonly liveTranslation: LiveTranslationTrigger;
  private settled = new StreamingCommitter();

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
  private readonly releaseController = new AbortController();
  /** Which translation of this turn is being written. Rises on every request. */
  private translationGeneration = 0;
  private readonly speculation = new TurnSpeculation();

  /** The pair as the client declared it, echoed on this turn's events. */
  readonly languagePair: SessionLanguagePair;
  /**
   * Which language this turn is in, and when that became known. Declared up
   * front for most turns; for a two-way turn, provisional while it is spoken,
   * locked for the live preview, and decided on the whole turn at its end.
   */
  readonly decision: TurnLanguageDecision;
  /** Which voice speaks this turn's translation, for every clause of it. */
  readonly voiceGender: VoiceGender;
  /**
   * Conversation hints for the translator, or undefined when the client sent none.
   *
   * Fixed for the life of the turn, and identical across every turn of the
   * session, because they describe the conversation rather than the sentence.
   */
  readonly hints?: TranslationHints;
  /**
   * Whether this turn is spoken at all. Defaulted HERE rather than in the schema:
   * the wire field is `.optional()` so that adding it did not make every existing
   * `SessionOptions` literal in the monorepo stop compiling.
   */
  readonly voiceOutput: boolean;
  /**
   * Whether every audio frame names its language (`lang`).
   *
   * True for any start that asked for `alsoTranslateInto`, however many of
   * those languages end up voiced: the client of such a turn routes audio to
   * listeners by language, and a frame without a tag would leave it guessing
   * when the speech engine could voice only one of them. A plain one-language
   * turn stays untagged, as it always was.
   */
  readonly tagsAudioLanguage: boolean;
  /** Whether a meeting's speaker leg opened this turn; see `SessionOptions.meeting`. */
  readonly meeting: boolean;
  /** Speaking rate. Honoured for English output; the Vietnamese engine has none. */
  readonly speed: number;
  /** An opaque backend voice token, when the client named one. */
  readonly voice?: string;
  /** A voice per spoken language, for a turn that may be spoken in either. */
  readonly voices?: Partial<Record<LanguageCode, string>>;
  /**
   * Whether this client asked for a voice vector for its turns.
   *
   * Per session rather than per turn because it is a property of the client, not
   * of anything said. A client that did not ask is never sent
   * `server.turn.embedding` — which is what keeps the event away from one built
   * before the event existed, and keeps turns that would discard it from paying
   * the sidecar for one.
   */
  readonly embedSpeaker: boolean;
  /**
   * Whether this client asked for a repaired rendering of its source text.
   *
   * Per session for the same reason as {@link embedSpeaker}: it is a property of
   * the client, not of anything said. A client that did not ask is never sent
   * `server.transcript.display`, which is what keeps the event away from a tab
   * built before the event existed — one that would otherwise fail its strict
   * union parse once per repaired turn.
   */
  readonly repairDisplay: boolean;
  /**
   * Who the turn's extra model calls are charged to, on the shared
   * `TranslationBudget`. The session id stands in when no user was named, which
   * is what the live translation trigger already did with the same field.
   */
  readonly userId: string;
  /** See {@link TurnSessionDeps.learnedTerms}. */
  readonly learnedTerms: readonly string[];
  /**
   * Whether this client can take a turn split where the voice changes.
   *
   * Only meaningful beside {@link embedSpeaker}: the split is decided from the
   * same vectors, and a client that does not attribute turns has no use for one.
   */
  readonly splitSpeakers: boolean;
  /** Whether this client asked to be sent settled transcript text. */
  readonly streamCommitted: boolean;
  /**
   * Whether this turn picks up an utterance the client's length ceiling cut, so
   * its translation needs the earlier speech it continues. Per turn; see
   * `SessionOptions.continuesCut`.
   */
  readonly continuesCut: boolean;

  // Takes the whole options object so the caller has one thing to pass, but
  // keeps the settings flat internally — everything below reads `this.languagePair`
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
    /**
     * What this turn spends mid-sentence translations against.
     *
     * Optional so the several specs that build a bare turn keep compiling, and
     * when it is absent the turn gets its OWN budget with a wide ceiling rather
     * than a path with no budget at all — a test should exercise the real policy,
     * not a branch that only tests see.
     */
    deps: TurnSessionDeps = {},
  ) {
    this.languagePair = options.languagePair;
    this.decision =
      deps.decision ?? declaredDecision(deps.languages ?? defaultPlan(options));
    this.voiceGender = options.voiceGender;
    this.hints = options.hints;
    this.voiceOutput = options.voiceOutput ?? true;
    this.tagsAudioLanguage = (options.alsoTranslateInto?.length ?? 0) > 0;
    this.meeting = options.meeting ?? false;
    this.speed = options.speed ?? 1;
    this.voice = options.voice;
    this.voices = options.voices;
    this.embedSpeaker = options.embedSpeaker ?? false;
    this.repairDisplay = options.repairDisplay ?? false;
    this.userId = deps.userId ?? this.sessionId;
    this.learnedTerms = deps.learnedTerms ?? [];
    this.splitSpeakers = this.embedSpeaker && (options.splitSpeakers ?? false);
    this.streamCommitted = options.streamCommitted ?? false;
    this.continuesCut = options.continuesCut ?? false;
    this.liveTranslation = new LiveTranslationTrigger({
      budget:
        deps.budget ?? new TranslationBudget({ perUserRpm: UNMETERED_RPM }),
      commitChars: commitCharsFor(
        deps.commitChars,
        () => this.languages.recognition,
      ),
      userId: this.userId,
      model: LIVE_TRANSLATION_MODELS[0] ?? '',
    });
  }

  /**
   * What this turn does, language-wise: which language it was spoken in, every
   * language it must be translated into, and which of those is recognised from
   * and spoken back as. Read from {@link decision} every time, because a
   * two-way turn's answer changes as it is decided.
   */
  get languages(): TurnLanguagePlan {
    return this.decision.plan;
  }

  /** Separates this turn's settled transcript text from the revisable rest. */
  get committer(): StreamingCommitter {
    return this.settled;
  }

  /**
   * Start settling again from nothing. For a two-way turn whose preview just
   * locked: what settled before was read in the provisional language, and a
   * reading in another one shares no prefix with it worth keeping.
   */
  resetCommitter(): void {
    this.settled = new StreamingCommitter();
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
   * Reads `this.languages` rather than the language pair directly: `recognition`
   * is the language this turn is actually taken to be spoken in — today always
   * the pair's declared source, but the field to read once a real identifier
   * can disagree with it. Delegates to the registry rather than comparing a
   * language to a literal: `speakerRoleFor` is what fixes `speaker_a` to the
   * conversation's registry-first language regardless of which side of the
   * pair this turn runs.
   */
  get speakerRole(): SpeakerRole {
    return speakerRoleFor(
      this.languages.recognition,
      this.languages.conversation,
    );
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

  /**
   * Fires when this turn leaves the registry — ended, abandoned, or its socket
   * gone. Handed to speech synthesis so a request still queued at the sidecar is
   * cancelled the moment nobody can hear it, instead of when its first chunk
   * arrives: a stream holds the engine for a whole turn, and every other turn in
   * that language is waiting behind it.
   */
  get released(): AbortSignal {
    return this.releaseController.signal;
  }

  /** Called by the registry as the turn leaves it. Idempotent. */
  release(): void {
    this.releaseController.abort();
  }

  nextOutboundSequence(): number {
    return this.outboundSequence++;
  }

  /**
   * A fresh label for the translation about to be written, and the one the
   * pieces of it carry.
   *
   * Per turn rather than per connection because the client clears its shown
   * translation when the label changes, and a turn's first translation must
   * always clear whatever the previous turn left behind.
   */
  nextTranslationGeneration(): number {
    return ++this.translationGeneration;
  }

  get currentTranslationGeneration(): number {
    return this.translationGeneration;
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

  /** Build this turn's persisted record. */
  toSegment(
    sourceText: string,
    translations: TranslationMap,
    sessionId: string = this.sessionId,
  ): TranscriptSegment {
    return {
      id: randomUUID(),
      sessionId,
      speakerRole: this.speakerRole,
      sourceLanguages: [...this.languages.sourceLanguages],
      translations,
      sourceText,
      // Audio travels over this socket rather than being stored.
      audioUrl: null,
      createdAt: new Date().toISOString(),
    };
  }
}

/** The plan of a turn built with neither a plan nor a decision. */
function defaultPlan(options: SessionOptions): TurnLanguagePlan {
  const { source, target } = options.languagePair;
  if (source === AUTO_DETECT) {
    throw new Error('A turn with an undeclared source needs its decision');
  }
  return planForPair(
    { source, target },
    DEFAULT_IDENTIFIER,
    // Extras ride on a declared one-way turn only, as `start()` applies them.
    options.twoWay ? [] : (options.alsoTranslateInto ?? []),
  );
}

/** A plan decided before the turn starts, as the decision a turn reads it through. */
function declaredDecision(plan: TurnLanguagePlan): TurnLanguageDecision {
  return new TurnLanguageDecision(
    'declared',
    [plan.recognition],
    plan.recognition,
    () => plan,
  );
}

function commitCharsFor(
  chars: TurnSessionDeps['commitChars'],
  language: () => LanguageCode,
): () => number {
  if (chars === undefined) return () => DEFAULT_COMMIT_CHARS;
  if (typeof chars === 'number') return () => chars;
  return () => chars(language());
}
