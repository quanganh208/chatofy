// Local text-to-speech — English and Vietnamese synthesis via the local
// sidecar (services/local-tts). POSTs text and returns wav bytes. Uses global
// fetch (Node 18+/22), no SDK dependency.
//
// One backend covers both output languages: the sidecar picks Kokoro for `en`
// and VieNeu for `vi` from the `language` field, then resolves `gender` against
// that engine's own two voices. This provider carries no voice catalog of its
// own — a speaker id means nothing to VieNeu and a preset name means nothing to
// Kokoro, so only the engine can turn a gender into a voice.
import type { TtsProvider, TtsSynthesizeRequest } from '../../interfaces/tts-provider.js';
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

  async synthesize(req: TtsSynthesizeRequest): Promise<Uint8Array> {
    const body: { text: string; language: string; gender?: string } = {
      text: req.text,
      language: req.language,
    };
    if (req.voiceGender) body.gender = req.voiceGender;

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
