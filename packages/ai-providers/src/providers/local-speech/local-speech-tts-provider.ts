// Local text-to-speech — English and Vietnamese synthesis via the local
// sidecar (services/local-tts). POSTs text and returns wav bytes. Uses global
// fetch (Node 18+/22), no SDK dependency.
//
// One backend covers both output languages: the sidecar picks Kokoro for `en`
// and VieNeu for `vi` from the `language` field, then resolves `gender` against
// that engine's own two voices. This provider carries no voice catalog of its
// own — a speaker id means nothing to VieNeu and a preset name means nothing to
// Kokoro, so only the engine can turn a gender into a voice.
import type { TtsProvider, TtsSynthesizeRequest, TtsVoice } from '../../interfaces/tts-provider.js';
import type { LanguageCode } from '@chatofy/types';
import {
  ProviderConfigError,
  ProviderConnectionError,
  ProviderResponseError,
} from '../../errors/provider-errors.js';
import { truncate } from '../http-util.js';

export interface LocalSpeechTtsConfig {
  /** Base URL of the sidecar, e.g. `http://localhost:8003`. */
  baseUrl?: string;
}

/**
 * What this provider accepts beyond the shared contract.
 *
 * `voice` lives HERE rather than on `TtsSynthesizeRequest` on purpose. Only a
 * provider that publishes a catalog can be given a token from it, and keeping the
 * field off the shared type is what makes that structural instead of a rule
 * someone has to remember — a provider that never declared a voice cannot be
 * handed one, whatever a caller does.
 */
interface LocalSpeechSynthesizeRequest extends TtsSynthesizeRequest {
  /** A token from {@link LocalSpeechTtsProvider.listVoices}. */
  voice?: string;
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
  async listVoices(language: LanguageCode): Promise<TtsVoice[]> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/voices?language=${encodeURIComponent(language)}`);
    } catch (err) {
      throw new ProviderConnectionError('Local TTS voice catalog request failed', err);
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new ProviderResponseError(
        `Local TTS /voices returned ${res.status}: ${truncate(detail)}`,
        res.status,
      );
    }

    const payload = (await res.json()) as { voices?: TtsVoice[] };
    return payload.voices ?? [];
  }

  async synthesize(req: LocalSpeechSynthesizeRequest): Promise<Uint8Array> {
    const body: {
      text: string;
      language: string;
      gender?: string;
      speed?: number;
      voice?: string;
    } = {
      text: req.text,
      language: req.language,
    };
    if (req.voiceGender) body.gender = req.voiceGender;
    // Passed through unchecked, and safely so: the sidecar whitelists it against
    // the engine's own catalog and falls back to the gender default when it does
    // not recognise it, so a stale token costs a voice rather than a turn.
    if (req.voice) body.voice = req.voice;
    // Sent only when asked for, so the sidecar's own default stays the single
    // definition of "natural pace". Kokoro applies it at synthesis; the Vietnamese
    // engine accepts and ignores it, which is why the UI offers the control for
    // English output only rather than everywhere.
    if (req.speed !== undefined) body.speed = req.speed;

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/synthesize`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new ProviderConnectionError('Local TTS request failed', err);
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new ProviderResponseError(
        `Local TTS returned ${res.status}: ${truncate(detail)}`,
        res.status,
      );
    }

    const buffer = await res.arrayBuffer();
    return new Uint8Array(buffer);
  }
}
