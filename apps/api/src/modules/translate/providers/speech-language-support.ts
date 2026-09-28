import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { LANGUAGE_CODES, type LanguageCode } from '@chatofy/types';
import type { SttProvider, TtsProvider } from '@chatofy/ai-providers';
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
 * TS↔Python parity, checked at RUNTIME rather than generated at build time (D7).
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
   */
  private refresh(): Promise<void> {
    this.inFlight ??= this.doRefresh().finally(() => {
      this.inFlight = null;
      this.refreshedAt = Date.now();
    });
    return this.inFlight;
  }

  private async doRefresh(): Promise<void> {
    const trio = this.providers.makeProviders();
    const [stt, tts] = await Promise.all([
      readSupported(trio.stt),
      readSupported(trio.tts),
    ]);
    this.sttLanguages = stt;
    this.ttsLanguages = tts;
    this.warnMissingEngines('STT', stt);
    this.warnMissingEngines('TTS', tts);
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
 * `null` when the provider takes every language (no `supportedLanguages` at
 * all) or when the answer is not known right now — a rejected probe is folded
 * into the same "no restriction" state as a provider that never restricts,
 * because a turn must not be refused on account of a fault this class cannot
 * yet tell apart from silence.
 */
async function readSupported(
  provider: SttProvider | TtsProvider,
): Promise<readonly LanguageCode[] | null> {
  if (!provider.supportedLanguages) return null;
  try {
    const served = await provider.supportedLanguages();
    return served.length > 0 ? served : null;
  } catch {
    return null;
  }
}
