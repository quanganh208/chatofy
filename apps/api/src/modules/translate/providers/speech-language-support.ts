import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { LANGUAGE_CODES, type LanguageCode } from '@chatofy/types';
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
  /** Language the translation must be SPOKEN in. */
  spoken: LanguageCode;
  /** Whether the turn wants audio at all — an unspeakable target only matters then. */
  voiceOutput: boolean;
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
      this.ttsLanguages &&
      !this.ttsLanguages.includes(plan.spoken)
    ) {
      return `This server cannot speak ${plan.spoken} right now`;
    }
    return null;
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
