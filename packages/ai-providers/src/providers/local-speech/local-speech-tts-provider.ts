// Local text-to-speech — English synthesis via the local sherpa-onnx sidecar
// (services/local-tts, Kokoro-82M). POSTs text and returns wav bytes. Uses
// global fetch (Node 18+/22), no SDK dependency.
//
// English only: Vietnamese output is routed to the VieNeu sidecar by the API's
// providers factory, so this provider never sees it. `language` is still sent
// so the sidecar's own guard is meaningful.
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
  /** Default Kokoro speaker id (as a string); per-request `voice` overrides it. */
  voice?: string;
}

export class LocalSpeechTtsProvider implements TtsProvider {
  readonly name = 'local';
  readonly outputMimeType = 'audio/wav';
  private readonly baseUrl: string;
  private readonly voice?: string;

  constructor(config: LocalSpeechTtsConfig) {
    if (!config.baseUrl) {
      throw new ProviderConfigError('Local TTS requires a baseUrl');
    }
    // Trim a trailing slash so `${baseUrl}/synthesize` never doubles up.
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.voice = config.voice;
  }

  async synthesize(req: TtsSynthesizeRequest): Promise<Uint8Array> {
    const body: { text: string; language: string; voice?: string } = {
      text: req.text,
      language: req.language,
    };
    const voice = req.voice ?? this.voice;
    if (voice) body.voice = voice;

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
