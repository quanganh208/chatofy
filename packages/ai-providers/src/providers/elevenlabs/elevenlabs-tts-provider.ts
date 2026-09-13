// ElevenLabs text-to-speech — batch synthesis via the REST API. Returns mp3
// bytes. Uses global fetch (Node 18+/22), no SDK dependency.
import type { TtsProvider, TtsSynthesizeRequest } from '../../interfaces/tts-provider.js';
import { ProviderConfigError, ProviderResponseError } from '../../errors/provider-errors.js';
import { fetchWithDeadline, ELEVENLABS_TIMEOUT_MS, truncate } from '../http-util.js';

const TTS_BASE = 'https://api.elevenlabs.io/v1/text-to-speech';
const DEFAULT_VOICE = '21m00Tcm4TlvDq8ikWAM'; // ElevenLabs "Rachel"
const DEFAULT_MODEL = 'eleven_flash_v2_5';
const DEFAULT_OUTPUT_FORMAT = 'mp3_44100_128';

export interface ElevenLabsTtsConfig {
  apiKey?: string;
  /**
   * The voice this backend speaks in. Not a default that something later
   * overrides — `TtsSynthesizeRequest` carries no voice id, only a gender, and
   * `synthesize` deliberately ignores that (see below). This is the only knob.
   *
   * `req.speed` is ignored here too, for the same reason: this provider sends no
   * rate parameter. Under `AI_TTS_PROVIDER=elevenlabs` the app's speed control
   * therefore does nothing, exactly as its gender control already does nothing.
   * That is a property of the deployment rather than a fault, but it is not
   * visible from the UI — anything wanting to key controls off real backend
   * capability needs a capability report, not a guess.
   */
  voice?: string;
  /** TTS model id, e.g. `eleven_flash_v2_5`. */
  model?: string;
  /** ElevenLabs output_format token; defaults to `mp3_44100_128`. */
  outputFormat?: string;
}

export class ElevenLabsTtsProvider implements TtsProvider {
  readonly name = 'elevenlabs';
  readonly outputMimeType = 'audio/mpeg';
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

  /**
   * `req.voiceGender` is deliberately ignored: one configured id is one voice,
   * of one gender, and inventing a second id here would mean guessing which
   * ElevenLabs voice the deployment considers its male or female counterpart.
   * This backend exists to compare latency and quality against the local stack,
   * not to ship a voice picker, so it always speaks in its configured voice.
   */
  async synthesize(req: TtsSynthesizeRequest): Promise<Uint8Array> {
    const url = `${TTS_BASE}/${this.voice}?output_format=${this.outputFormat}`;

    const res = await fetchWithDeadline(
      url,
      {
        method: 'POST',
        headers: { 'xi-api-key': this.apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({
          text: req.text,
          model_id: this.model,
          language_code: req.language,
        }),
      },
      ELEVENLABS_TIMEOUT_MS,
      'ElevenLabs TTS request',
    );

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new ProviderResponseError(
        `ElevenLabs TTS returned ${res.status}: ${truncate(detail)}`,
        res.status,
      );
    }

    const buffer = await res.arrayBuffer();
    return new Uint8Array(buffer);
  }
}
