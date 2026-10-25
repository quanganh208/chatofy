import { mergeHotwords } from '../session/conversation-context';
import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ProviderAbortedError,
  ProviderBusyError,
  ProviderConfigError,
  ProviderConnectionError,
  ProviderNotImplementedError,
  ProviderResponseError,
  acceptHomophoneRepairs,
  acceptRecognizerFusion,
  mergeCorrections,
  wordsOf,
  type TranscriptCorrection,
  type LoanwordProposal,
  type LoanwordRespeller,
  type SpeakerEmbeddingResult,
  type TranslationHints,
  type TtsAudioStream,
  type TtsProvider,
  type TtsSynthesizeRequest,
  type TtsVoiceCatalog,
} from '@chatofy/ai-providers';
import {
  type LanguageCode,
  type LanguageTable,
  type TranslateResponse,
  type VoiceGender,
} from '@chatofy/types';
import { AiProvidersFactory } from '../providers/ai-providers.factory';
import {
  retryAdoptedTranslations,
  translateInTargetScript,
  type ScriptRetry,
} from './foreign-script-retry';
import type {
  DeclaredTurnLanguagePlan,
  TurnLanguagePlan,
  TranslationMap,
} from '../session/turn-language-plan';
import type { HeardLanguage } from '../session/turn-language-decision';

/**
 * How long a fetched voice catalog is reused.
 *
 * The web app asks on every mount and this fans out to a sidecar whose CPU is
 * being spent on speech. Short enough that restarting the speech backend is
 * picked up without restarting the api.
 */
const VOICE_CACHE_TTL_MS = 60_000;

/**
 * The speech engine was serving another turn for longer than this one could
 * wait for it.
 *
 * Still a 503 with the same message a REST caller has always had, so
 * that contract is unchanged; its own class so a live turn can tell "lost the
 * queue" from "the backend is broken" and end without audio instead of failing.
 */
export class SpeechEngineBusyException extends ServiceUnavailableException {
  constructor() {
    super('Translation provider request failed');
  }
}

/**
 * The recognizer heard less speech than the caller's floor asked for.
 *
 * A subclass of the plain `BadRequestException` {@link PipelineTranslatorService.transcribeAndTranslate}
 * has always thrown on an empty transcript, so `handlePipelineError`'s
 * unconditional `if (err instanceof BadRequestException) throw err;` already
 * lets it through unchanged — no mapping to add there. Its own class exists so
 * the session service can tell "the gate refused this turn" from "the
 * recognizer heard nothing for some other reason" and end the two differently:
 * the gated case ends quietly (no banner, counted as `no_speech`); every other
 * empty decode keeps today's `turn_failed` banner. Thrown only when the
 * SIDECAR'S OWN VERDICT says the gate refused the turn — a floor was asked for
 * AND the backend reported `speechMs` below it — see `transcribeAndTranslate`.
 * A floor asked for but never answered (ElevenLabs, or a sidecar that predates
 * `speechMs`) and a floor cleared but the decoder still returned nothing both
 * keep the plain exception, because neither is the gate's doing.
 */
export class NoSpeechDetectedException extends BadRequestException {
  constructor(message = 'No speech detected in the audio') {
    super(message);
  }
}

/**
 * Decoded input for one translation turn.
 *
 * Carries no language of its own: which language(s) to recognise, and which to
 * translate into, are the caller's `TurnLanguagePlan`, passed as its own
 * argument to every method that needs one below. Keeping the plan out of this
 * object is what lets `transcribe`/`translate` take a single language directly
 * while `transcribeAndTranslate`/`translateTurn` take the whole plan, without
 * the type lying about which fields either path actually reads.
 */
export interface TranslateTurnInput {
  audio: Uint8Array;
  mimeType: string;
  /** Which voice speaks the translation; the TTS backend defaults an omitted one. */
  voiceGender?: VoiceGender;
  /** Speaking rate; ignored by backends that have no rate control. */
  speed?: number;
  /**
   * Translation models to try, in order, instead of the provider's own list.
   *
   * The streaming path sets this; REST does not, so the baseline keeps the
   * provider's full ladder including its slow last resort. See
   * `translation-session.service.ts` for why a live turn cannot afford that one.
   */
  models?: string[];
  /**
   * Conversation-level hints for the translator, fixed for the whole session.
   *
   * Set once when the session opens and carried on every turn of it, because
   * what the conversation is about does not change between one sentence and the
   * next — and re-deciding it per turn would let the topic drift mid-session.
   */
  hints?: TranslationHints;
  /**
   * Source utterances that already finished on this connection, oldest first.
   *
   * The opposite of {@link hints} in every way that matters: it changes every
   * turn, it comes from the speaker rather than the operator, and it exists for
   * the turns hints cannot help — a two-word fragment that means nothing without
   * the sentence it is inside. Passed straight to the translator, which owns how
   * much of it a prompt can afford.
   */
  context?: string[];
  /** The turn picks up an utterance the client's length ceiling cut. */
  continuesCut?: boolean;
  /**
   * Spellings this conversation learned from earlier turns' guarded
   * respellings, as hotwords for the RECOGNIZER only.
   *
   * Kept apart from {@link hints} on purpose: hints reach the translation
   * prompt, and these come from whoever is speaking in the room rather than
   * from the account owner, so they bias what is heard and are never written
   * into an instruction.
   */
  learnedTerms?: string[];
  /**
   * Silero speech floor, in ms, the local sidecar should apply before a decode
   * counts as containing anything.
   *
   * Rides along to `stt.transcribe` beside `hotwords`, exactly like it: a
   * backend that cannot gate on speech ignores it rather than failing. `0` or
   * absent both mean "no floor" — see `NoSpeechDetectedException` for the one
   * place its presence changes behaviour on this side of the provider call.
   */
  minSpeechMs?: number;
  /**
   * Also restore punctuation and case on the transcript, for display, beside
   * the translation. Absent means the turn did not ask for a display.
   */
  restoreDisplay?: DisplayRestoreRequest;
  /**
   * Also decode the turn with a second recognizer, for
   * {@link PipelineTranslatorService.correctTranscript} to fuse with the first.
   * Asked only where a display will be corrected: a live re-read or a turn
   * with no display would pay for a decode nobody reads.
   */
  alternates?: boolean;
  /**
   * One more translation per target if the final answer leaked a foreign
   * script (see `ScriptRetry`). Absent on a speculation: if one is adopted, the
   * caller runs the check then, with `retryAdopted`.
   */
  scriptRetry?: ScriptRetry;
  /**
   * Languages the recognizer should choose between, the decoded one among
   * them. Absent (or one language) is a declared decode, as every turn was
   * before identification existed.
   */
  candidates?: readonly LanguageCode[];
  /**
   * Told when the backend refused `candidates` because it cannot identify now,
   * so the caller stops asking before its capability cache would have noticed.
   */
  onIdentifyUnavailable?: () => void;
}

/**
 * How a turn whose language is not declared gets its plan: recognised first
 * with candidates, then decided on what that recognition heard.
 *
 * A resolver rather than a plan because what the turn is translated against
 * depends on the language: its display restore, and which earlier speech is
 * its context, are both only known once the language is.
 */
export interface TurnLanguageResolver {
  /** The language asked for while the turn is undecided: decoded if the backend cannot identify. */
  readonly provisional: LanguageCode;
  readonly candidates: readonly LanguageCode[];
  /** Whether a second recognizer's reading is wanted, asked before the language is known. */
  readonly alternates: boolean;
  /** The turn's plan, and what it is translated against, for what the recognition heard. */
  resolve(heard: HeardLanguage): ResolvedTurnInput;
}

function isResolver(
  languages: TurnLanguagePlan | TurnLanguageResolver,
): languages is TurnLanguageResolver {
  return 'resolve' in languages;
}

/** What a resolver decided for one turn. */
export interface ResolvedTurnInput {
  plan: TurnLanguagePlan;
  restoreDisplay?: DisplayRestoreRequest;
  context?: string[];
  continuesCut?: boolean;
}

/** What a display restore reads besides the transcript. */
export interface DisplayRestoreRequest {
  /** The utterance this turn continues, for a turn opened on a forced cut. */
  context?: string;
  /** The session's hotwords; the restorer uses the mixed-case ones as forms. */
  terms?: string[];
  /**
   * Silence after each word of the transcript in ms, as the recognizer
   * measured it; a full stop where the speaker never paused is dropped.
   */
  pauses?: number[];
}

/**
 * How long a display restore may run, measured from when it STARTED.
 *
 * It starts beside the translation (restore p95 ~110 ms, translation ~700 ms),
 * so on an ordinary turn it is done before anything waits for it. Measured from
 * its own start rather than from the translation's end, so a stuck restorer
 * costs a fast turn at most this, and a slow translation nothing at all.
 */
export const RESTORE_BUDGET_MS = 300;

/**
 * Recognition languages whose finished transcript is checked for words misheard
 * as a word that sounds the same.
 *
 * Vietnamese only, because only its guard exists: `soundKey` knows which
 * Vietnamese spellings share a sound. Chinese homophones are real, but a guard
 * for them would have to be built and measured on its own.
 */
const REPAIRS_HOMOPHONES: LanguageTable<boolean> = {
  vi: true,
  en: false,
  zh: false,
};

/**
 * Recognition languages whose finished transcript is fused with a second
 * recognizer's, when the backend has one.
 *
 * Vietnamese only: the second recognizer and the prompt that picks between
 * them are both Vietnamese, and only that pair was measured: with the
 * homophone repair beside it, 5.86% → 4.73–4.91% WER on 6 recorded
 * conversations (`benchmarks/recognizer-fusion`).
 */
const FUSES_RECOGNIZERS: LanguageTable<boolean> = {
  vi: true,
  en: false,
  zh: false,
};

/**
 * How many earlier transcripts a correction reads: the number both checks were
 * measured with. A correction needs the topic ("a stabbing", "a flood"), and
 * two sentences carry it.
 */
const CORRECTION_CONTEXT_TURNS = 2;

/**
 * How long a turn waits for its corrections once its translation is in.
 *
 * Not the whole of their cost: a turn that asks for a second recognizer's
 * transcript also waits for it in the STT sidecar, up to
 * `LOCAL_STT_ALTERNATE_WAIT_MS` (400 ms) past the primary's, before the
 * translation can start.
 *
 * The checks start beside the translation and usually end first. Measured on
 * 94 recorded turns against the production host, both in flight together: the
 * homophone repair finished first on 65 of them, and with this grace it was
 * lost on 4. So the line — and the speech that follows it — is never more than
 * this late on their account, and the cost of a slow host is a correction, not
 * a turn.
 */
export const CORRECTION_GRACE_MS = 250;

/**
 * `correcting` if it settles within {@link CORRECTION_GRACE_MS} of now, else
 * undefined. For the moment the translation is in: only the wait from here on
 * is the reader's.
 */
export async function settleCorrections(
  correcting: Promise<TranscriptCorrection[] | undefined> | undefined | null,
): Promise<TranscriptCorrection[] | undefined> {
  if (!correcting) return undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), CORRECTION_GRACE_MS);
  });
  try {
    // A display correction never fails the turn it rides on.
    return await Promise.race([correcting.catch(() => undefined), late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * How long a WHOLE block's display restore may run.
 *
 * Longer than a turn's, because nothing waits on it: the block's own
 * retranslation runs beside it for ~700 ms, and the line it replaces is already
 * on screen. Measured on the sidecar at ~1.2 ms a word (210 words, 250 ms); a
 * block is at most `MAX_BLOCK_SEGMENTS` forced pieces of ~8 s.
 */
export const BLOCK_RESTORE_BUDGET_MS = 1_500;

/**
 * After a restorer reports itself absent (404 from an older sidecar, 503 before
 * its model is seeded, or no sidecar listening at all), how long to stop asking.
 * A permanent condition answered on every speculation and every turn is one
 * warning, not five per turn.
 */
const RESTORE_UNAVAILABLE_COOLDOWN_MS = 60_000;

/**
 * A request that found no restorer at all — nothing listening, no such host —
 * as opposed to a timeout (a slow sidecar) or a reset mid-request (a transient
 * hiccup). Only the first is an absent sidecar worth a process-wide pause; the
 * others may well be answered on the next turn.
 */
function isRefusedConnection(err: unknown): boolean {
  if (!(err instanceof ProviderConnectionError)) return false;
  // fetch wraps the socket error: ProviderConnectionError → TypeError('fetch
  // failed') → the system error carrying the code.
  for (let cause: unknown = err.cause, depth = 0; depth < 3; depth += 1) {
    if (!(cause instanceof Error)) return false;
    const code = (cause as Error & { code?: unknown }).code;
    if (typeof code === 'string') return ABSENT_RESTORER_CODES.has(code);
    cause = cause.cause;
  }
  return false;
}

/** Socket error codes that mean no restorer is there to answer. */
const ABSENT_RESTORER_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'EAI_AGAIN',
]);

/**
 * The text half of a turn — everything decided before speech is synthesized.
 *
 * `translations` replaces the single `targetText`/`targetLanguage` this used to
 * carry: a turn is translated into every one of its plan's `targets`, not only
 * the one that gets spoken. A caller that wants the spoken text reads
 * `translations[plan.spoken]`.
 */
export interface TranslatedTurnText {
  sourceText: string;
  translations: TranslationMap;
  /**
   * `sourceText` with punctuation and case restored, for display only. Absent
   * when the turn did not ask, or the restorer failed or ran late.
   */
  restored?: string;
  /**
   * Stretches of `sourceText` with the words that were said instead, already
   * through `acceptRecognizerFusion` or `acceptHomophoneRepairs`. For display
   * only; absent when the turn asked for no display or nothing was corrected.
   */
  corrections?: TranscriptCorrection[];
  /**
   * Silence after each word of `sourceText` in ms, when the recognizer
   * measured it. Kept so a block joining this turn can restore with it.
   */
  pauses?: number[];
  /**
   * Silence before the first word in ms, measured with `pauses`. A block that
   * joins this turn after another adds it to that one's last pause.
   */
  leadPause?: number;
  /**
   * The language this text was decided in, and what the recognition heard to
   * decide it — set only on a turn translated through a resolver. A reused
   * speculation is checked against them: it is the turn's answer only if the
   * final, asked at the endpoint, decides the same language.
   */
  language?: LanguageCode;
  heard?: HeardLanguage;
}

/**
 * What one `transcribe` call answered: the text, and — when the backend ran a
 * speech detector for it — how much of the audio it measured as speech.
 *
 * `speechMs` is what tells an empty `text` apart from a gate's own refusal;
 * see {@link NoSpeechDetectedException}.
 */
export interface TranscribedAudio {
  text: string;
  speechMs?: number;
  /** Silence after each word of `text` in ms; see `SttTranscriptResult`. */
  pauses?: number[];
  /** Silence before the first word in ms; see `SttTranscriptResult`. */
  leadPause?: number;
  /** The same audio as a second recognizer heard it; see `SttTranscriptResult`. */
  alternates?: string[];
  /**
   * Which candidate the audio was in, when `candidates` were asked for. A
   * backend that could not identify answers the language it was asked to
   * decode, with no confidence.
   */
  heard?: HeardLanguage;
}

/** One synthesis request. */
export interface SynthesizeRequest {
  text: string;
  language: LanguageCode;
  voiceGender?: VoiceGender;
  /**
   * Speaking rate. Backends that have no rate control ignore it — the Vietnamese
   * engine is one, so this changes nothing for `vi` output and the UI says so
   * rather than offering a control that silently does nothing.
   */
  speed?: number;
  /**
   * A specific voice, as a token the running backend published.
   *
   * Forwarded ONLY to a provider that implements `listVoices` — see `synthesize`.
   * A backend that advertises no catalog cannot have produced this token, so
   * handing it one would be handing it a value from somewhere else entirely.
   */
  voice?: string;
}

/** Synthesized speech plus the container the backend chose for it. */
export interface SynthesizedSpeech {
  bytes: Uint8Array;
  mimeType: string;
}

// Nominal format passed to TTS; providers emit their own container regardless.
const AUDIO_FORMAT = {
  encoding: 'pcm16',
  sampleRate: 44100,
  channels: 1,
} as const;

/**
 * The provider request for one synthesis, shared by the whole-WAV and the
 * streamed path so the two cannot disagree about which voice a backend is sent.
 *
 * A voice token goes only to the provider that could have published it.
 * `listVoices` is the capability check AND the gate: a backend with no catalog
 * never sees a token, so a value saved while a different backend was configured
 * cannot reach code that might interpolate it somewhere. That is the shape of a
 * real outage this guards against, not a hypothetical.
 */
function ttsRequestFor(
  tts: TtsProvider,
  req: SynthesizeRequest,
): TtsSynthesizeRequest & { voice?: string } {
  const voice = tts.listVoices ? req.voice : undefined;
  return {
    speed: req.speed,
    ...(voice ? { voice } : {}),
    text: req.text,
    language: req.language,
    audioFormat: AUDIO_FORMAT,
    voiceGender: req.voiceGender,
  };
}

/**
 * Orchestrates one turn-based translation: STT → translate → TTS.
 * Languages follow the requested language pair and are passed to each
 * provider, which is told the language per call.
 * Provider errors are mapped to HTTP exceptions so the response envelope carries
 * a meaningful status instead of a raw 500.
 */
@Injectable()
export class PipelineTranslatorService {
  private readonly logger = new Logger(PipelineTranslatorService.name);
  /**
   * See {@link RESTORE_UNAVAILABLE_COOLDOWN_MS}. Per language, because each
   * language has its own restorer behind the one endpoint: a zh model that is
   * missing must pause zh restores, never Vietnamese ones.
   */
  private readonly restoreUnavailableUntil = new Map<LanguageCode, number>();
  /** Per-language voice catalog, with the wall-clock time it goes stale. */
  private readonly voiceCache = new Map<
    LanguageCode,
    TtsVoiceCatalog & { expiresAt: number }
  >();

  constructor(private readonly providers: AiProvidersFactory) {}

  /**
   * One whole turn, synthesized in a single call.
   *
   * This is the REST shape and the measurement baseline the streaming path is
   * compared against, so the audio must keep coming from ONE `synthesize` call:
   * the streaming path splits the text into clauses, which changes prosody at
   * the seams and would stop this being a like-for-like comparison.
   *
   * REST answers ONE audio, for `plan.spoken` — the same budget the streaming
   * path applies to its preview, made explicit here in the swagger docs on
   * `TranslateController`. A fan-out turn still translates into every one of
   * `plan.targets`; only the synthesized side is singular.
   */
  async translateTurn(
    input: TranslateTurnInput,
    plan: DeclaredTurnLanguagePlan,
  ): Promise<TranslateResponse> {
    const { sourceText, translations } = await this.transcribeAndTranslate(
      input,
      plan,
    );
    const targetText = translations[plan.spoken] ?? '';

    const speech = await this.synthesize({
      text: targetText,
      language: plan.spoken,
      voiceGender: input.voiceGender,
      speed: input.speed,
    });

    return {
      sourceText,
      targetText,
      audioBase64: Buffer.from(speech.bytes).toString('base64'),
      audioMimeType: speech.mimeType,
    };
  }

  /**
   * Whether this deployment's translation host has a respeller at all. False
   * rather than thrown when resolving it fails, so a caller deciding a turn's
   * ordering can never be broken by it.
   */
  canRespellLoanwords(): boolean {
    try {
      return this.providers.makeLoanwordRespeller() !== null;
    } catch {
      return false;
    }
  }

  /**
   * A model's proposed spellings for a transcript's garbled foreign spans.
   *
   * Never rejects, like {@link restoreDisplay}: the answer only ever improves a
   * display, so a host that is down, slow or refusing costs the turn its
   * respelling and nothing else. The proposals are NOT checked here — that is
   * `acceptRespellings`, which the caller applies before anything is shown.
   */
  async respellLoanwords(
    transcript: string,
    spans: string[],
    translation: string,
    /** Whether `translation` is written in Han characters; see `LoanwordRespellRequest`. */
    translationInHan = false,
  ): Promise<Record<string, LoanwordProposal>> {
    const start = Date.now();
    try {
      const respeller = this.providers.makeLoanwordRespeller();
      if (!respeller || spans.length === 0) return {};
      const proposals = await respeller.respell({
        transcript,
        spans,
        translation,
        ...(translationInHan ? { translationInHan } : {}),
      });
      this.logger.log(
        `respell(${respeller.name}) ${Date.now() - start}ms spans=${spans.length}`,
      );
      return proposals;
    } catch (err) {
      this.logger.warn(
        `loanword respelling failed after ${Date.now() - start}ms, the turn keeps its display: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return {};
    }
  }

  /**
   * Guarded corrections of `text`, or undefined when there are none: stretches
   * a second recognizer heard better ({@link FUSES_RECOGNIZERS}, when
   * `alternates` came back with the transcript), and words misheard as a word
   * that sounds the same ({@link REPAIRS_HOMOPHONES}).
   *
   * Started beside the translation, like the display restore: both checks read
   * only transcripts and the sentences before — the homophone repair, given the
   * translation as well, was measured giving the same answers — so on an
   * ordinary turn they are done before the translation is, and the line waits
   * for nothing. The two run at once, and where they touch the same words the
   * fusion's correction is kept: it is the one another recognizer heard.
   *
   * Never rejects. The display is an enhancement on a transcript that is
   * already right; a host that is down or slow costs the turn its corrections,
   * never its text. The answers are checked here, because the checks read
   * nothing but transcripts.
   *
   * Not charged to the `TranslationBudget`, unlike a respelling: at most two
   * calls per transcribe-and-translate (per piece, for a split), beside its
   * translation — a speculation included, because an adopted speculation IS
   * the final — and the budget exists for the per-minute ceiling the live lane
   * can hit. A call abandoned after its grace is not aborted; its own ceiling
   * ends it.
   */
  async correctTranscript(
    text: string,
    recognition: LanguageCode,
    context: readonly string[] = [],
    alternates: readonly string[] = [],
    /** The turn's hint terms, whose words a fusion never changes. */
    keep: readonly string[] = [],
  ): Promise<TranscriptCorrection[] | undefined> {
    if (!text.trim()) return undefined;
    const heard = wordsOf(text).join(' ');
    // An alternate that heard the same words has nothing to offer, and on the
    // measured set half the turns were such: those cost no call.
    // The first only: it is the one the prompt shows, so it is the only one
    // whose words the guard may take as the model's evidence.
    const differing = FUSES_RECOGNIZERS[recognition]
      ? alternates
          .slice(0, 1)
          .filter((alternate) => wordsOf(alternate).join(' ') !== heard)
      : [];
    if (!REPAIRS_HOMOPHONES[recognition] && differing.length === 0)
      return undefined;
    let checker: LoanwordRespeller | null;
    try {
      checker = this.providers.makeLoanwordRespeller();
    } catch (err) {
      this.logger.warn(
        `transcript checks unavailable, the turn keeps its display: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return undefined;
    }
    if (!checker) return undefined;
    const before = context.slice(-CORRECTION_CONTEXT_TURNS);
    const [fused, repaired] = await Promise.all([
      differing.length > 0
        ? this.check('fusion', checker, async () =>
            acceptRecognizerFusion(
              text,
              differing,
              await checker.fuseRecognizers({
                transcript: text,
                alternates: differing,
                before,
              }),
              keep,
            ),
          )
        : [],
      REPAIRS_HOMOPHONES[recognition]
        ? this.check('homophones', checker, async () =>
            acceptHomophoneRepairs(
              text,
              await checker.repairHomophones({ transcript: text, before }),
            ),
          )
        : [],
    ]);
    const corrections = mergeCorrections(fused, repaired);
    return corrections.length > 0 ? corrections : undefined;
  }

  /** One check's accepted corrections, timed and logged; empty when it failed. */
  private async check(
    what: string,
    checker: LoanwordRespeller,
    run: () => Promise<TranscriptCorrection[]>,
  ): Promise<TranscriptCorrection[]> {
    const start = Date.now();
    try {
      const accepted = await run();
      this.logger.log(
        `${what}(${checker.name}) ${Date.now() - start}ms accepted=${accepted.length}`,
      );
      return accepted;
    } catch (err) {
      this.logger.warn(
        `${what} failed after ${Date.now() - start}ms, the turn keeps its display: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return [];
    }
  }

  /**
   * Punctuation and case for a finished transcript, or `undefined`.
   *
   * Never rejects. The display is an enhancement on a transcript that is
   * already right; a restorer that is down, unseeded or slow costs the turn its
   * typesetting, never its text.
   */
  async restoreDisplay(
    text: string,
    language: LanguageCode,
    request: DisplayRestoreRequest,
    budgetMs = RESTORE_BUDGET_MS,
  ): Promise<string | undefined> {
    if (Date.now() < (this.restoreUnavailableUntil.get(language) ?? 0))
      return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const outOfTime = new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), budgetMs);
    });
    try {
      // Only a transcript from the local recognizer arrives bare. A cloud one
      // already punctuates and cases its own output, and the restorer — which
      // lowercases every word before tagging — would replace that with its
      // own, weaker reading.
      if (!this.providers.sttWritesBareText()) return undefined;
      const restorer = this.providers.makeDisplayRestorer();
      const start = Date.now();
      const restored = await Promise.race([
        restorer.restore(text, { language, ...request }).then((value) => {
          this.logger.log(`restore(${restorer.name}) ${Date.now() - start}ms`);
          return value;
        }),
        outOfTime,
      ]);
      return restored;
    } catch (err) {
      const status =
        err instanceof ProviderResponseError ? err.status : undefined;
      if (status === 429) {
        // Momentarily busy: the sidecar refused rather than queued. Expected
        // under load, and the turn simply keeps its plain display — but at
        // info, not debug, because a busy restorer is exactly what makes the
        // measured display quality fail to reproduce, and it must be countable
        // from the ordinary log. At most one line per restore asked for, which
        // is bounded by the turns themselves.
        this.logger.log(
          'display restore busy, the turn keeps its plain display',
        );
        return undefined;
      }
      if (status === 404 || status === 503 || isRefusedConnection(err)) {
        this.restoreUnavailableUntil.set(
          language,
          Date.now() + RESTORE_UNAVAILABLE_COOLDOWN_MS,
        );
      }
      this.logger.warn(
        `display restore failed, the turn keeps its plain display: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * A voice vector for one turn, or `null` if anything went wrong.
   *
   * **Never throws, and that is the contract.** Attribution is an enhancement on
   * a translator: a sidecar that is down, slow or upset must cost a label, not a
   * translation. Every other failure in this file routes through
   * `handlePipelineError` and ends the turn; this one is logged and swallowed.
   *
   * The caller must start this BESIDE transcription rather than after it. The
   * whole reason the sidecar exposes a second endpoint is so this cost lands in
   * parallel with work that was happening anyway; awaited at the call site it
   * becomes serial and buys nothing.
   */
  async embedSpeaker(
    input: TranslateTurnInput,
  ): Promise<SpeakerEmbeddingResult | null> {
    try {
      const provider = this.providers.makeSpeakerEmbedding();
      const start = Date.now();
      // The whole result, not just the vector. `speechMs` is what tells the
      // client whether the vector means anything — a turn under the floor
      // carries no speaker information, and dropping the field here would put
      // the decision back where it cannot be made.
      const result = await provider.embed(input.audio, input.mimeType);
      this.logger.log(`embed(${provider.name}) ${Date.now() - start}ms`);
      return result;
    } catch (err) {
      this.logger.warn(
        `speaker embedding failed, turn continues unattributed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }

  /**
   * Transcribe only, with no opinion about whether anything was said.
   *
   * Split out for the live transcript, which decodes the same utterance over
   * and over as it grows. Its first attempts run on a moment of pre-roll and
   * routinely come back empty — which is the recogniser working, not failing.
   * The "no speech detected" rejection therefore belongs to whoever asked for a
   * whole turn, and lives one level up in {@link transcribeAndTranslate}.
   *
   * Returns `speechMs` beside the text rather than text alone, so a caller can
   * tell the gate's own verdict from a decoder that simply heard nothing — see
   * {@link NoSpeechDetectedException}.
   */
  async transcribe(
    input: TranslateTurnInput & { language: LanguageCode },
  ): Promise<TranscribedAudio> {
    try {
      const trio = this.providers.makeProviders();
      // Once a conversation has learned a term, every later turn decodes with
      // the biased (beam) recognizer; this line is what makes that visible in a
      // production log rather than only as a slower `stt(...)` time.
      if (input.learnedTerms?.length) {
        this.logger.log(
          `stt hotwords user=${input.hints?.hotwords?.length ?? 0} learned=${input.learnedTerms.length}`,
        );
      }
      const sttStart = Date.now();
      const identifying = (input.candidates?.length ?? 0) >= 2;
      const {
        text,
        speechMs,
        pauses,
        leadPause,
        alternates,
        language,
        languageConfidence,
        identified,
        lidSpeechMs,
      } = await trio.stt.transcribe(
        input.audio,
        input.mimeType,
        input.language,
        // The same hints the translator gets. A hotword is named because the
        // RECOGNIZER mishears it, so spending the list here first is what the
        // field was always for; the translator still receives it, for the term
        // that biasing does not recover.
        //
        // Learned terms follow the user's, under the same ceiling.
        {
          hotwords: mergeHotwords(input.hints?.hotwords, input.learnedTerms),
          minSpeechMs: input.minSpeechMs,
          // Named only when asked, so an ordinary request is unchanged.
          ...(input.alternates === true &&
          (identifying
            ? input.candidates!.some(
                (candidate) => FUSES_RECOGNIZERS[candidate],
              )
            : FUSES_RECOGNIZERS[input.language])
            ? { alternates: true }
            : {}),
          ...(identifying
            ? {
                candidates: [...input.candidates!],
                onIdentifyUnavailable: input.onIdentifyUnavailable,
              }
            : {}),
        },
      );
      this.logger.log(`stt(${trio.stt.name}) ${Date.now() - sttStart}ms`);
      return {
        text,
        speechMs,
        ...(pauses === undefined ? {} : { pauses }),
        ...(leadPause === undefined ? {} : { leadPause }),
        ...(alternates === undefined ? {} : { alternates }),
        ...(identifying
          ? {
              heard:
                identified === true
                  ? {
                      language,
                      confidence: languageConfidence ?? null,
                      ...(lidSpeechMs === undefined
                        ? {}
                        : { speechMs: lidSpeechMs }),
                    }
                  : { language: input.language, confidence: null },
            }
          : {}),
      };
    } catch (err) {
      return this.handlePipelineError(err);
    }
  }

  /**
   * Translate text that has already been transcribed.
   *
   * Split out for the live translation, which works from the running transcript
   * rather than from audio, so re-transcribing to reach the translator would
   * pay twice for a reading it already has.
   */
  async translate(req: {
    text: string;
    source: LanguageCode;
    target: LanguageCode;
    models?: string[];
    hints?: TranslationHints;
    /** Finished source utterances from earlier in this conversation, oldest first. */
    context?: string[];
    /** The turn picks up an utterance the client's length ceiling cut. */
    continuesCut?: boolean;
    /**
     * Called with each piece of the translation as it is written.
     *
     * Passed straight through; a provider that cannot stream never calls it.
     * `restart` marks the first piece of an attempt — a provider may abandon
     * one key and retry on another, and a caller that appends blindly would
     * splice two different translations together.
     */
    onChunk?: (delta: string, restart: boolean) => void;
    /** One more call if the answer leaks a foreign script; see `ScriptRetry`. */
    scriptRetry?: ScriptRetry;
  }): Promise<string> {
    try {
      const trio = this.providers.makeProviders();
      // Every answer, streamed or final, is rendered in its target's script
      // (Simplified for Chinese), and a final one may be retried once.
      return await translateInTargetScript(
        async (onChunk) => {
          const start = Date.now();
          const { text, model } = await trio.translation.translate({
            text: req.text,
            sourceLanguage: req.source,
            targetLanguage: req.target,
            models: req.models,
            hints: req.hints,
            context: req.context,
            continuesCut: req.continuesCut,
            onChunk,
          });
          this.logger.log(
            `translate(${model ?? trio.translation.name}) ${Date.now() - start}ms`,
          );
          return text;
        },
        req,
        this.logger,
      );
    } catch (err) {
      return this.handlePipelineError(err);
    }
  }

  /**
   * The script check a reused speculation skipped: its translations were made
   * without a `ScriptRetry`, and adopting one runs no final call. Never
   * rejects; a target whose retry fails keeps the answer it had.
   */
  retryAdopted(
    translated: Pick<TranslatedTurnText, 'sourceText' | 'translations'>,
    source: LanguageCode,
    req: {
      models?: string[];
      hints?: TranslationHints;
      scriptRetry: ScriptRetry;
    },
  ): Promise<TranslationMap> {
    return retryAdoptedTranslations(
      translated.sourceText,
      source,
      translated.translations,
      (target) =>
        this.translate({
          text: translated.sourceText,
          source,
          target,
          models: req.models,
          hints: req.hints,
        }),
      req.scriptRetry,
      this.logger,
    );
  }

  /**
   * `translate`, fanned out over every target — the shape a turn's FINAL
   * translation always takes, whether that turn has one target or several.
   *
   * `Promise.all`, not a sequential loop: each target is an independent
   * request against (today) the same model ladder, and a turn with several
   * targets must not wait on them one at a time. One target costs exactly what
   * a single `translate` call always cost.
   */
  async translateAll(req: {
    text: string;
    source: LanguageCode;
    targets: readonly LanguageCode[];
    models?: string[];
    hints?: TranslationHints;
    context?: string[];
    continuesCut?: boolean;
    scriptRetry?: ScriptRetry;
  }): Promise<TranslationMap> {
    // A transcript-only turn: nothing to translate into, so no provider call.
    if (req.targets.length === 0) return {};
    const entries = await Promise.all(
      req.targets.map(
        async (target) =>
          [
            target,
            await this.translate({
              text: req.text,
              source: req.source,
              target,
              models: req.models,
              hints: req.hints,
              context: req.context,
              continuesCut: req.continuesCut,
              scriptRetry: req.scriptRetry,
            }),
          ] as const,
      ),
    );
    return Object.fromEntries(entries);
  }

  /**
   * Transcribe and translate, stopping before synthesis.
   *
   * Split out for the streaming path, which needs the text on its own twice
   * over: to synthesize it clause by clause, and to run this half early on a
   * suspected end-of-speech while the endpoint is still being confirmed.
   */
  async transcribeAndTranslate(
    turnInput: TranslateTurnInput,
    languages: TurnLanguagePlan | TurnLanguageResolver,
  ): Promise<TranslatedTurnText> {
    try {
      let input = turnInput;
      let decided: TurnLanguagePlan;
      let heard: HeardLanguage | undefined;
      let recognition: TranscribedAudio;
      if (isResolver(languages)) {
        recognition = await this.transcribe({
          ...input,
          language: languages.provisional,
          candidates: languages.candidates,
          alternates: languages.alternates,
        });
        heard = recognition.heard ?? {
          language: languages.provisional,
          confidence: null,
        };
        const resolved = languages.resolve(heard);
        decided = resolved.plan;
        input = {
          ...input,
          restoreDisplay: resolved.restoreDisplay,
          context: resolved.context,
          continuesCut: resolved.continuesCut,
        };
        // Decided against what was heard — unsure, so the previous turn's
        // language or the source — and decoded in another: the text belongs
        // to the engine of the language decided, so it is read again there.
        if (decided.recognition !== heard.language && recognition.text.trim()) {
          recognition = await this.transcribe({
            ...input,
            language: decided.recognition,
            alternates: input.restoreDisplay !== undefined,
          });
        }
      } else {
        decided = languages;
        recognition = await this.transcribe({
          ...input,
          language: decided.recognition,
          alternates: input.restoreDisplay !== undefined,
        });
      }
      const {
        text: sourceText,
        speechMs,
        pauses,
        leadPause,
        alternates,
      } = recognition;
      if (!sourceText.trim()) {
        // Logged, not merely thrown, because how often this fires is itself the
        // open question. Two production recordings each lost one utterance and
        // this was the leading suspect — until the same audio was decoded twelve
        // ways through the live sidecar and came back non-empty every time. If
        // that holds, this branch is rare and the losses are elsewhere; if it
        // does not, this line is what will say so. Bytes rather than a duration:
        // decoding happened inside the provider and the length is not back here.
        //
        // `gated` reads the sidecar's OWN VERDICT, not merely whether a floor
        // was asked for. A floor was requested on every one of these three
        // shapes, and only the first is the gate's doing:
        //   - `speechMs` came back below the floor — Silero measured too little
        //     speech, the decoder never ran, `text` is empty by construction;
        //   - `speechMs` is undefined — the backend cannot gate on speech
        //     (ElevenLabs) or predates the field, so the floor was silently
        //     ignored and this empty decode means something else entirely;
        //   - `speechMs` came back AT OR ABOVE the floor — Silero heard enough
        //     speech, the decoder ran anyway, and still answered nothing. That
        //     is the exact "lost utterance" case the warning above exists to
        //     catch, and swallowing it here would be losing it a second time.
        // Only the first keeps quiet; the other two keep today's banner.
        const floor = input.minSpeechMs ?? 0;
        const gated = floor > 0 && speechMs !== undefined && speechMs < floor;
        this.logger.warn(
          `No speech detected: ${decided.recognition} ${input.audio.byteLength}B ${input.mimeType} gated=${gated} speechMs=${speechMs ?? 'n/a'}`,
        );
        throw gated
          ? new NoSpeechDetectedException()
          : new BadRequestException('No speech detected in the audio');
      }

      // Each target logs its own model and timing inside `translate`; nothing
      // further to add here.
      // Started before the translation and awaited after it, so its cost sits
      // beside the translation rather than in front of the speech.
      const restoring = input.restoreDisplay
        ? this.restoreDisplay(sourceText, decided.recognition, {
            ...input.restoreDisplay,
            ...(pauses === undefined ? {} : { pauses }),
          })
        : undefined;
      const correcting = input.restoreDisplay
        ? this.correctTranscript(
            sourceText,
            decided.recognition,
            input.context,
            alternates,
            mergeHotwords(input.hints?.hotwords, input.learnedTerms),
          )
        : undefined;
      const translations = await this.translateAll({
        text: sourceText,
        source: decided.recognition,
        targets: decided.targets,
        models: input.models,
        hints: input.hints,
        context: input.context,
        continuesCut: input.continuesCut,
        scriptRetry: input.scriptRetry,
      });
      const restored = await restoring;
      const corrections = await settleCorrections(correcting);

      return {
        sourceText,
        translations,
        ...(restored === undefined ? {} : { restored }),
        ...(corrections === undefined ? {} : { corrections }),
        ...(pauses === undefined ? {} : { pauses }),
        ...(leadPause === undefined ? {} : { leadPause }),
        ...(heard === undefined
          ? {}
          : { language: decided.recognition, heard }),
      };
    } catch (err) {
      return this.handlePipelineError(err);
    }
  }

  /** Synthesize one piece of text — a whole turn for REST, one clause for WS. */
  /**
   * Voices the configured TTS backend offers, cached briefly.
   *
   * Empty when the backend publishes no catalog — which is a real answer meaning
   * "no choice here", not a failure. A backend without `listVoices` is also the
   * one that must never be sent a voice token, and `synthesize` enforces that
   * with the same check.
   *
   * The cache exists because the web app asks on every mount and this call fans
   * out to a sidecar that is busy synthesizing speech. Short enough that a
   * restarted backend is picked up without anyone restarting the api.
   */
  async listVoices(language: LanguageCode): Promise<TtsVoiceCatalog> {
    const cached = this.voiceCache.get(language);
    // Reshaped rather than returned by reference: the cache entry carries
    // `expiresAt` alongside the catalog, and a cache hit answering that field
    // made the response shape depend on whether this happened to be a cold or
    // a warm call — the controller serialises whatever this returns.
    // `speedAdjustable` is copied only when present: absent means "unknown"
    // (see `TtsVoiceCatalog`), and a warm call must answer the same shape as
    // the cold one it cached.
    if (cached && Date.now() < cached.expiresAt) {
      const { expiresAt: _expiresAt, ...catalog } = cached;
      return catalog;
    }

    const trio = this.providers.makeProviders();
    // An explicit `false`, not "unknown": the only backend without a catalog
    // (ElevenLabs) sends no rate parameter at all, so the rate control would
    // silently do nothing and the client should hide it.
    if (!trio.tts.listVoices) return { voices: [], speedAdjustable: false };

    const catalog = await trio.tts.listVoices(language);
    this.voiceCache.set(language, {
      ...catalog,
      expiresAt: Date.now() + VOICE_CACHE_TTL_MS,
    });
    return catalog;
  }

  async synthesize(req: SynthesizeRequest): Promise<SynthesizedSpeech> {
    try {
      const trio = this.providers.makeProviders();

      const ttsStart = Date.now();
      const bytes = await trio.tts.synthesize(ttsRequestFor(trio.tts, req));
      this.logger.log(`tts(${trio.tts.name}) ${Date.now() - ttsStart}ms`);

      // The provider that synthesized the audio owns its container format.
      return { bytes, mimeType: trio.tts.outputMimeType };
    } catch (err) {
      return this.handlePipelineError(err);
    }
  }

  /**
   * The same synthesis as `synthesize`, delivered as the backend produces it —
   * or `null` when this backend cannot stream, and the caller should fall back
   * to `synthesize` clause by clause.
   *
   * Resolves at first audio, which is what the log line times. The same voice
   * gate applies: a token reaches only a provider that could have published it.
   *
   * `ProviderAbortedError` passes through unmapped. It means `signal` fired —
   * the listener left — and that is not a provider fault to report as one.
   * Failures while the stream is being read are the caller's to map, through
   * `failSynthesis`, so a turn that breaks part-way reads exactly like one that
   * broke before its first byte.
   */
  async synthesizeStream(
    req: SynthesizeRequest,
    signal: AbortSignal,
  ): Promise<TtsAudioStream | null> {
    try {
      const trio = this.providers.makeProviders();
      if (!trio.tts.synthesizeStream) return null;

      const ttsStart = Date.now();
      const stream = await trio.tts.synthesizeStream(
        ttsRequestFor(trio.tts, req),
        signal,
      );
      if (stream) {
        this.logger.log(
          `tts-stream(${trio.tts.name}) first-audio ${Date.now() - ttsStart}ms`,
        );
      }
      return stream;
    } catch (err) {
      if (err instanceof ProviderAbortedError) throw err;
      return this.handlePipelineError(err);
    }
  }

  /** Map a provider fault met while READING a speech stream, as above. */
  failSynthesis(err: unknown): never {
    return this.handlePipelineError(err);
  }

  private handlePipelineError(err: unknown): never {
    if (err instanceof BadRequestException) throw err;
    if (err instanceof ProviderConfigError) {
      // Same reason the connection branch below logs its cause: "misconfigured"
      // does not distinguish a missing key from one the API rejected, and the
      // rejection body is the only thing that says which remedy applies.
      this.logger.error(
        `Provider misconfigured: ${err.message}`,
        err.cause instanceof Error ? err.cause.stack : undefined,
      );
      throw new ServiceUnavailableException(
        'Translation provider is not configured',
      );
    }
    if (err instanceof ProviderNotImplementedError) {
      this.logger.error(err.message);
      throw new ServiceUnavailableException(
        'Selected translation provider is not available',
      );
    }
    if (err instanceof ProviderConnectionError) {
      // Log the wrapped cause too: the provider message alone ("… request
      // failed") cannot distinguish a down sidecar from a rejected API key,
      // which makes a transport failure undiagnosable from the logs.
      this.logger.error(
        `Provider request failed: ${err.message}`,
        err.cause instanceof Error ? err.cause.stack : String(err.cause),
      );
      throw new ServiceUnavailableException(
        'Translation provider request failed',
      );
    }
    if (err instanceof ProviderBusyError) {
      this.logger.warn(`Speech engine busy: ${err.message}`);
      throw new SpeechEngineBusyException();
    }
    if (err instanceof ProviderResponseError) {
      this.logger.error(
        `Provider returned an unusable response: ${err.message}`,
      );
      throw new ServiceUnavailableException(
        'Translation provider request failed',
      );
    }
    throw err;
  }
}
