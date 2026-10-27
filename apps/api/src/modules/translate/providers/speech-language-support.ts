import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import {
  AUTO_DETECT,
  LANGUAGE_CODES,
  canIdentify,
  languagePairOf,
  turnCandidates,
  type LanguageCode,
  type LanguagePair,
  type SessionLanguageMode,
  type SessionLanguagePair,
} from '@chatofy/types';
import type {
  ServedLanguages,
  SttProvider,
  TtsProvider,
} from '@chatofy/ai-providers';
import { AiProvidersFactory } from './ai-providers.factory';

/** How long a served-language answer is trusted before it is asked again. */
const REFRESH_INTERVAL_MS = 60_000;

/** What one turn needs served, to check against what the running engines report. */
export interface LanguagePlan {
  /** Language the turn's audio must be RECOGNISED in. */
  recognition: LanguageCode;
  /**
   * Language the translation must be SPOKEN in; null for a turn with nothing
   * to translate into, which asks no engine to speak.
   */
  spoken: LanguageCode | null;
  /** Whether the turn wants audio at all — an unspeakable target only matters then. */
  voiceOutput: boolean;
}

/** Why a session runs less than it asked for, or cannot run at all. */
const LANGUAGE_DETECTION_REASON = 'language_detection';

/** What a start asks for, language-wise, and what this process can give it. */
export interface LanguageModeRequest {
  pair: SessionLanguagePair;
  twoWay: boolean;
  /**
   * Languages the STT engine reported it can identify, or `null` when that is
   * not known — not yet probed, a failed probe, or a backend with no
   * `supportedLanguages` at all. Unknown is treated as "cannot identify".
   */
  identifiable: readonly LanguageCode[] | null;
  /** The modes this build of the session path actually runs. */
  servedModes: readonly SessionLanguageMode[];
}

/** The mode a start is admitted to, or why it is refused. */
export type LanguageAdmission =
  | {
      admitted: true;
      mode: 'declared' | 'two-way';
      pair: LanguagePair;
      /** Set when `mode` is less than the start asked for. */
      modeReason?: typeof LANGUAGE_DETECTION_REASON;
    }
  | { admitted: true; mode: 'detect'; target: LanguageCode }
  | {
      admitted: false;
      detail: typeof LANGUAGE_DETECTION_REASON;
      message: string;
    };

/**
 * Decide which language mode a start runs. The one place that does, so a mode
 * reaching the turn is always one this check approved.
 *
 * Identification is only used when all three hold: the shipped identifier can
 * tell the candidates apart at all (`canIdentify` — no Chinese, today), the
 * running engine says it can identify every one of them right now, and this
 * build serves the mode. Otherwise:
 *
 *  - a declared pair asked to run two-way DEGRADES to declared one-way and
 *    says why — the speaker still gets what every session got before, which is
 *    better than no session;
 *  - an undeclared source is REFUSED: there is no declared language to fall
 *    back to, and guessing one would translate the wrong way silently.
 *
 * Unknown capability fails closed here, unlike `refusal()`, which fails open:
 * a wrong "can identify" sends candidates the engine cannot honour, and a
 * wrong "cannot" only runs a declared turn.
 */
export function admitLanguageMode(
  request: LanguageModeRequest,
): LanguageAdmission {
  const { source, target } = request.pair;
  // `twoWay` means nothing beside an undeclared source, which is one-way by
  // definition, so it is not part of what that source has to be served.
  const twoWay = source !== AUTO_DETECT && request.twoWay;
  const wanted: SessionLanguageMode =
    source === AUTO_DETECT ? 'detect' : twoWay ? 'two-way' : 'declared';
  const identifiable = request.identifiable;
  const served =
    wanted === 'declared' ||
    (request.servedModes.includes(wanted) &&
      canIdentify(request.pair, twoWay) &&
      identifiable !== null &&
      turnCandidates(request.pair, twoWay).every((language) =>
        identifiable.includes(language),
      ));

  if (source === AUTO_DETECT) {
    return served
      ? { admitted: true, mode: 'detect', target }
      : {
          admitted: false,
          detail: LANGUAGE_DETECTION_REASON,
          message:
            'This server cannot identify the spoken language right now; choose the language you speak',
        };
  }
  const pair = languagePairOf(source, target);
  if (served)
    return {
      admitted: true,
      mode: wanted === 'two-way' ? 'two-way' : 'declared',
      pair,
    };
  return {
    admitted: true,
    mode: 'declared',
    pair,
    modeReason: LANGUAGE_DETECTION_REASON,
  };
}

/**
 * TS↔Python parity, checked at RUNTIME rather than generated at build time.
 *
 * Reads each configured provider's `supportedLanguages()` — which, for the
 * local sidecars, is a read of their own `/healthz` — and keeps the answer
 * around for {@link REFRESH_INTERVAL_MS} rather than asking on every turn: a
 * turn is on the clock, and a health check is not.
 *
 * **Never awaited at boot.** `onApplicationBootstrap` fires the first refresh
 * and returns immediately, so a sidecar that is down, or merely still loading
 * its models, cannot hold the whole API from starting. Every turn started
 * before the first answer lands is treated exactly like every turn started
 * after a failed refresh: "not known yet" is not "unavailable", so nothing is
 * refused for it.
 *
 * `null` for a language set means "no restriction is known" — either the
 * configured backend takes every language a cloud provider would (parity here
 * is ⊆, not =, so a provider with no `supportedLanguages` at all imposes none),
 * or the answer has not arrived. Both fail OPEN: refusing a language the
 * operator never restricted is a worse fault than occasionally forwarding a
 * turn to an engine that, it turns out, was not there — the sidecar's own 400
 * is the backstop for that case, same as it always was.
 */
@Injectable()
export class SpeechLanguageSupport implements OnApplicationBootstrap {
  private readonly logger = new Logger(SpeechLanguageSupport.name);
  private sttLanguages: readonly LanguageCode[] | null = null;
  private ttsLanguages: readonly LanguageCode[] | null = null;
  /**
   * What the STT engine can identify, `null` while that is not known. A
   * resolved probe that reported no identifier is `[]`, not `null`: known to
   * identify nothing.
   */
  private sttIdentifiable: readonly LanguageCode[] | null = null;
  /**
   * The STT engine can say what it identifies but has not answered yet: still
   * loading its models, or down. Not the same `null` as a provider with no
   * probe at all, which will never answer and is not asked again early.
   */
  private sttAnswerPending = true;
  /**
   * Tags each engine last reported that the registry does not know. Kept
   * across a failed probe rather than cleared: a sidecar that blinks out and
   * comes back reporting the same stray tag has not told us anything new.
   */
  private sttUnknown: readonly string[] = [];
  private ttsUnknown: readonly string[] = [];
  private refreshedAt = 0;
  private inFlight: Promise<void> | null = null;

  constructor(private readonly providers: AiProvidersFactory) {}

  onApplicationBootstrap(): void {
    // `void`: the app finishes booting whether or not any sidecar answers.
    void this.refresh();
  }

  /**
   * The reason this plan cannot be served right now, or `null` when it can.
   *
   * Triggers a background refresh when the last answer has aged past
   * {@link REFRESH_INTERVAL_MS}, without waiting for it — the turn calling this
   * is answered from whatever is already known, and the next one benefits from
   * the refresh in flight.
   */
  refusal(plan: LanguagePlan): string | null {
    if (Date.now() - this.refreshedAt >= REFRESH_INTERVAL_MS)
      void this.refresh();

    if (this.sttLanguages && !this.sttLanguages.includes(plan.recognition)) {
      return `This server cannot recognise ${plan.recognition} speech right now`;
    }
    if (
      plan.voiceOutput &&
      plan.spoken !== null &&
      this.ttsLanguages &&
      !this.ttsLanguages.includes(plan.spoken)
    ) {
      return `This server cannot speak ${plan.spoken} right now`;
    }
    return null;
  }

  /**
   * The languages the STT engine can identify right now, or `null` when that is
   * not known. Read for {@link admitLanguageMode}; refreshed on the same
   * interval as {@link refusal}.
   */
  identifiable(): readonly LanguageCode[] | null {
    // Asked again on every call while the engine owes an answer, not once a
    // minute: the API boots in seconds and the sidecar loads its models for
    // longer, so a deploy that recreates both would otherwise refuse every
    // detect start and run every two-way one way for up to a minute after the
    // sidecar is ready. Coalesced, so a burst of starts is still one probe.
    if (
      this.sttAnswerPending ||
      Date.now() - this.refreshedAt >= REFRESH_INTERVAL_MS
    )
      void this.refresh();
    return this.sttIdentifiable;
  }

  /**
   * Ask both engines again without waiting out the interval — for a caller
   * that just learned the cached answer is wrong, such as the STT engine
   * refusing candidates it was reported to accept. Coalesced with any refresh
   * already in flight, and never rejects.
   */
  refreshNow(): Promise<void> {
    return this.refresh();
  }

  /**
   * Re-check both providers against the registry.
   *
   * Coalesced into one in-flight promise: a burst of turns each finding the
   * answer stale must not each start their own probe of both providers.
   *
   * Never rejects: every caller fires it with `void`, so a rejection here would
   * be an unhandled one — which takes the process down. Building the providers
   * can throw (a backend name with no implementation), and that is the same
   * "not known" state as a probe that failed.
   */
  private refresh(): Promise<void> {
    this.inFlight ??= this.doRefresh()
      .catch((error: unknown) => {
        this.logger.warn(
          `Could not read which languages the speech engines serve: ${String(error)}`,
        );
      })
      .finally(() => {
        this.inFlight = null;
        this.refreshedAt = Date.now();
      });
    return this.inFlight;
  }

  private async doRefresh(): Promise<void> {
    const trio = this.providers.makeProviders();
    const [sttServed, ttsServed] = await Promise.all([
      readSupported(trio.stt),
      readSupported(trio.tts),
    ]);
    const stt = sttServed?.known ?? null;
    const tts = ttsServed?.known ?? null;
    // Compared against what was served BEFORE this refresh, not logged
    // unconditionally: a deployment that deliberately runs without one engine
    // served the identical set a minute ago too, and warning again every
    // refresh forever is noise that trains an operator to stop reading this
    // logger. The fields are overwritten after, so this is the only chance to
    // see what changed.
    if (!servedSetsEqual(this.sttLanguages, stt)) {
      this.warnMissingEngines('STT', stt);
    }
    if (!servedSetsEqual(this.ttsLanguages, tts)) {
      this.warnMissingEngines('TTS', tts);
    }
    this.sttLanguages = stt;
    this.ttsLanguages = tts;
    // Not known when the probe was not answered; an answer without the field
    // is an engine that identifies nothing.
    this.sttIdentifiable = sttServed ? (sttServed.identifiable ?? []) : null;
    this.sttAnswerPending =
      sttServed === null && trio.stt.supportedLanguages !== undefined;
    // Same once-per-change rule for tags the registry does not know: the
    // sidecar reports them on every refresh, forever, until the registry
    // catches up.
    if (sttServed)
      this.sttUnknown = this.warnUnknownTags(
        'STT',
        this.sttUnknown,
        sttServed.unknown,
      );
    if (ttsServed)
      this.ttsUnknown = this.warnUnknownTags(
        'TTS',
        this.ttsUnknown,
        ttsServed.unknown,
      );
  }

  /**
   * Warns about the tags an engine reported that name no registry language,
   * only when that set differs from what it reported last time. Returns the
   * set to remember.
   */
  private warnUnknownTags(
    kind: string,
    previous: readonly string[],
    current: readonly string[],
  ): readonly string[] {
    if (!sameTags(previous, current) && current.length > 0) {
      this.logger.warn(
        `${kind} engine reported languages the registry does not know: ${current.map((tag) => `'${tag}'`).join(', ')}`,
      );
    }
    return current;
  }

  /** One warning per registry language a KNOWN, restrictive provider excludes. */
  private warnMissingEngines(
    kind: string,
    served: readonly LanguageCode[] | null,
  ): void {
    if (!served) return;
    for (const code of LANGUAGE_CODES) {
      if (!served.includes(code)) {
        this.logger.warn(
          `No ${kind} engine reported for registry language '${code}'`,
        );
      }
    }
  }
}

/**
 * Whether two served-language answers are the same set, `null` included.
 *
 * `null` means "no restriction known" (see the class doc), and it is its own
 * distinct case here: a provider that just started restricting languages, or
 * just stopped, is exactly the change {@link SpeechLanguageSupport.doRefresh}
 * exists to notice. Order-independent, because a provider is under no
 * obligation to report its languages in the same order twice.
 */
function servedSetsEqual(
  a: readonly LanguageCode[] | null,
  b: readonly LanguageCode[] | null,
): boolean {
  if (a === null || b === null) return a === b;
  return sameTags(a, b);
}

/** Order-independent equality of two de-duplicated tag lists. */
function sameTags(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((tag) => b.includes(tag));
}

/**
 * `null` when the provider takes every language (no `supportedLanguages` at
 * all) or when the answer is not known right now — a rejected probe is folded
 * into the same "no restriction" state as a provider that never restricts,
 * because a turn must not be refused on account of a fault this class cannot
 * yet tell apart from silence.
 */
async function readSupported(
  provider: SttProvider | TtsProvider,
): Promise<ServedLanguages | null> {
  if (!provider.supportedLanguages) return null;
  try {
    const served = await provider.supportedLanguages();
    return served.known.length > 0 ? served : null;
  } catch {
    return null;
  }
}
