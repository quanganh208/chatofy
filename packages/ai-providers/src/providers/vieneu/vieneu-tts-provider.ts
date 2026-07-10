// VieNeu-TTS text-to-speech — Vietnamese synthesis via the local Python sidecar
// (services/vieneu-tts). POSTs text to /synthesize and returns wav bytes. Uses
// global fetch (Node 18+/22), no SDK dependency.
import type { TtsProvider, TtsSynthesizeRequest } from '../../interfaces/tts-provider.js';
import { ProviderConfigError, ProviderConnectionError } from '../../errors/provider-errors.js';
import { truncate } from '../http-util.js';

export interface VieNeuTtsConfig {
  /** Base URL of the sidecar, e.g. `http://localhost:8001`. */
  baseUrl?: string;
  /** Default preset voice; per-request `voice` overrides this. */
  voice?: string;
}

export class VieNeuTtsProvider implements TtsProvider {
  readonly name = 'vieneu';
  private readonly baseUrl: string;
  private readonly voice?: string;

  constructor(config: VieNeuTtsConfig) {
    if (!config.baseUrl) {
      throw new ProviderConfigError('VieNeu TTS requires a baseUrl');
    }
    // Trim a trailing slash so `${baseUrl}/synthesize` never doubles up.
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.voice = config.voice;
  }

  async synthesize(req: TtsSynthesizeRequest): Promise<Uint8Array> {
    const body: { text: string; voice?: string } = { text: req.text };
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
      throw new ProviderConnectionError('VieNeu TTS request failed', err);
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new ProviderConnectionError(`VieNeu TTS returned ${res.status}: ${truncate(detail)}`);
    }

    const buffer = await res.arrayBuffer();
    return new Uint8Array(buffer);
  }
}
