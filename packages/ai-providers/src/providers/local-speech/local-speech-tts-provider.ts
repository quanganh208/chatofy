// Local text-to-speech — English and Vietnamese synthesis via the local
// sidecar (services/local-tts). POSTs text and returns wav bytes. Uses global
// fetch (Node 18+/22), no SDK dependency.
//
// One backend covers both output languages: the sidecar picks Kokoro for `en`
// and VieNeu for `vi` from the `language` field, then resolves `gender` against
// that engine's own two voices. This provider carries no voice catalog of its
// own — a speaker id means nothing to VieNeu and a preset name means nothing to
// Kokoro, so only the engine can turn a gender into a voice.
import type {
  TtsAudioStream,
  TtsProvider,
  TtsSynthesizeRequest,
  TtsVoice,
  TtsVoiceCatalog,
} from '../../interfaces/tts-provider.js';
import type { ServedLanguages } from '../../interfaces/stt-provider.js';
import type { LanguageCode } from '@chatofy/types';
import {
  ProviderConfigError,
  ProviderConnectionError,
  ProviderResponseError,
} from '../../errors/provider-errors.js';
import {
  fetchWithDeadline,
  LOCAL_HEALTHZ_TIMEOUT_MS,
  LOCAL_TTS_TIMEOUT_MS,
  LOCAL_TTS_VOICES_TIMEOUT_MS,
  truncate,
} from '../http-util.js';
import {
  localTtsError,
  openLocalTtsStream,
  synthesisBody,
  type LocalSpeechSynthesizeRequest,
} from './local-speech-tts-stream.js';
import { readServedLanguages } from './served-languages.js';

export interface LocalSpeechTtsConfig {
  /** Base URL of the sidecar, e.g. `http://localhost:8003`. */
  baseUrl?: string;
}

export class LocalSpeechTtsProvider implements TtsProvider {
  readonly name = 'local';
  readonly outputMimeType = 'audio/wav';
  private readonly baseUrl: string;

  constructor(config: LocalSpeechTtsConfig) {
    if (!config.baseUrl) {
      throw new ProviderConfigError('Local TTS requires a baseUrl');
    }
    // Trim a trailing slash so `${baseUrl}/synthesize` never doubles up.
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
  }

  /**
   * The curated voices the sidecar reports for a language.
   *
   * Fetched rather than declared: which voices exist belongs to whichever engine
   * is loaded over there, and a copy kept here would be wrong the day it changed.
   * A failure is reported rather than swallowed — the caller decides whether an
   * unreachable catalog means "no choice available" or something worth showing.
   */
  async listVoices(language: LanguageCode): Promise<TtsVoiceCatalog> {
    const res = await fetchWithDeadline(
      `${this.baseUrl}/voices?language=${encodeURIComponent(language)}`,
      {},
      LOCAL_TTS_VOICES_TIMEOUT_MS,
      'Local TTS voice catalog request',
    );

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new ProviderResponseError(
        `Local TTS /voices returned ${res.status}: ${truncate(detail)}`,
        res.status,
      );
    }

    const payload = (await res.json()) as { voices?: TtsVoice[]; speedAdjustable?: unknown };
    const voices = payload.voices ?? [];
    // Absent on a sidecar deployed before this field existed, and passed on
    // absent rather than defaulted: `TtsVoiceCatalog.speedAdjustable` reads a
    // missing value as UNKNOWN, which the web keeps the rate control visible
    // for. Defaulting to `false` here would hide it on an engine that honours
    // `speed`. A non-boolean is treated as absent for the same reason.
    return typeof payload.speedAdjustable === 'boolean'
      ? { voices, speedAdjustable: payload.speedAdjustable }
      : { voices };
  }

  /**
   * The registry languages `/healthz` reports this sidecar speaking. See
   * `LocalSpeechSttProvider.supportedLanguages` for why a call this cannot
   * answer REJECTS rather than resolving an empty list.
   */
  async supportedLanguages(): Promise<ServedLanguages> {
    const served = await readServedLanguages(this.baseUrl, LOCAL_HEALTHZ_TIMEOUT_MS);
    if (!served) {
      throw new ProviderConnectionError('Local TTS did not report which languages it serves');
    }
    return served;
  }

  async synthesize(req: LocalSpeechSynthesizeRequest): Promise<Uint8Array> {
    const body = synthesisBody(req);

    const res = await fetchWithDeadline(
      `${this.baseUrl}/synthesize`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      LOCAL_TTS_TIMEOUT_MS,
      'Local TTS request',
    );

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw localTtsError('Local TTS', res, detail);
    }

    const buffer = await res.arrayBuffer();
    return new Uint8Array(buffer);
  }

  /**
   * The whole text from `POST /synthesize/stream`, as the engine produces it,
   * or `null` from a sidecar that predates the endpoint.
   * See {@link openLocalTtsStream}.
   */
  synthesizeStream(
    req: LocalSpeechSynthesizeRequest,
    signal: AbortSignal,
  ): Promise<TtsAudioStream | null> {
    return openLocalTtsStream(this.baseUrl, synthesisBody(req), signal);
  }
}
