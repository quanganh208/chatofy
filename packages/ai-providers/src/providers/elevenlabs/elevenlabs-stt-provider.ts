// ElevenLabs Scribe speech-to-text — batch transcription via the REST API.
// Uses global fetch/FormData/Blob (Node 18+/22), no SDK dependency.
import type { LanguageCode } from '../../interfaces/provider-types.js';
import type { SttProvider, SttTranscriptResult } from '../../interfaces/stt-provider.js';
import { ProviderConfigError, ProviderConnectionError } from '../../errors/provider-errors.js';
import { extFromMime, truncate } from '../http-util.js';

const STT_ENDPOINT = 'https://api.elevenlabs.io/v1/speech-to-text';
const DEFAULT_MODEL = 'scribe_v2';

export interface ElevenLabsSttConfig {
  apiKey?: string;
  /** Scribe model id; defaults to `scribe_v2`. */
  model?: string;
}

interface ScribeResponse {
  text?: string;
  language_code?: string;
}

export class ElevenLabsSttProvider implements SttProvider {
  readonly name = 'elevenlabs';
  private readonly apiKey: string;
  private readonly model: string;

  constructor(config: ElevenLabsSttConfig) {
    if (!config.apiKey) {
      throw new ProviderConfigError('ElevenLabs STT requires an apiKey');
    }
    this.apiKey = config.apiKey;
    this.model = config.model ?? DEFAULT_MODEL;
  }

  async transcribe(
    audio: Uint8Array,
    mimeType: string,
    language: LanguageCode,
  ): Promise<SttTranscriptResult> {
    const form = new FormData();
    form.append('model_id', this.model);
    // Passing language_code improves accuracy and avoids silent auto-detect.
    form.append('language_code', language);
    // Copy into a fresh ArrayBuffer-backed view so the bytes satisfy BlobPart
    // regardless of the caller's backing buffer (TS typed-array generics).
    const fileBlob = new Blob([new Uint8Array(audio)], { type: mimeType });
    form.append('file', fileBlob, `audio.${extFromMime(mimeType)}`);

    let res: Response;
    try {
      res = await fetch(STT_ENDPOINT, {
        method: 'POST',
        headers: { 'xi-api-key': this.apiKey },
        body: form,
      });
    } catch (err) {
      throw new ProviderConnectionError('ElevenLabs STT request failed', err);
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new ProviderConnectionError(
        `ElevenLabs STT returned ${res.status}: ${truncate(detail)}`,
      );
    }

    const json = (await res.json().catch(() => null)) as ScribeResponse | null;
    if (!json || typeof json.text !== 'string') {
      throw new ProviderConnectionError('ElevenLabs STT returned an unexpected response');
    }
    return { text: json.text, language };
  }
}
