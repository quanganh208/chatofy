// ElevenLabs text-to-speech — batch synthesis via the REST API. Returns mp3
// bytes. Uses global fetch (Node 18+/22), no SDK dependency.
import type { TtsProvider, TtsSynthesizeRequest } from '../../interfaces/tts-provider.js';
import { ProviderConfigError, ProviderConnectionError } from '../../errors/provider-errors.js';
import { truncate } from '../http-util.js';

const TTS_BASE = 'https://api.elevenlabs.io/v1/text-to-speech';
const DEFAULT_VOICE = '21m00Tcm4TlvDq8ikWAM'; // ElevenLabs "Rachel"
const DEFAULT_MODEL = 'eleven_flash_v2_5';
const DEFAULT_OUTPUT_FORMAT = 'mp3_44100_128';

export interface ElevenLabsTtsConfig {
  apiKey?: string;
  /** Default voice id; per-request `voice` overrides this. */
  voice?: string;
  /** TTS model id, e.g. `eleven_flash_v2_5`. */
  model?: string;
  /** ElevenLabs output_format token; defaults to `mp3_44100_128`. */
  outputFormat?: string;
}

export class ElevenLabsTtsProvider implements TtsProvider {
  readonly name = 'elevenlabs';
  private readonly apiKey: string;
  private readonly voice: string;
  private readonly model: string;
  private readonly outputFormat: string;

  constructor(config: ElevenLabsTtsConfig) {
    if (!config.apiKey) {
      throw new ProviderConfigError('ElevenLabs TTS requires an apiKey');
    }
    this.apiKey = config.apiKey;
    this.voice = config.voice ?? DEFAULT_VOICE;
    this.model = config.model ?? DEFAULT_MODEL;
    this.outputFormat = config.outputFormat ?? DEFAULT_OUTPUT_FORMAT;
  }

  async synthesize(req: TtsSynthesizeRequest): Promise<Uint8Array> {
    const voiceId = req.voice ?? this.voice;
    const url = `${TTS_BASE}/${voiceId}?output_format=${this.outputFormat}`;

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'xi-api-key': this.apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({
          text: req.text,
          model_id: this.model,
          language_code: req.language,
        }),
      });
    } catch (err) {
      throw new ProviderConnectionError('ElevenLabs TTS request failed', err);
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new ProviderConnectionError(
        `ElevenLabs TTS returned ${res.status}: ${truncate(detail)}`,
      );
    }

    const buffer = await res.arrayBuffer();
    return new Uint8Array(buffer);
  }
}
