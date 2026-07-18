// TtsProvider contract — text-to-speech synthesis (e.g. ElevenLabs, OpenAI TTS)
import type { AudioFormat, LanguageCode, ProviderConfig, StreamHandle } from './provider-types.js';

export interface TtsProviderConfig extends ProviderConfig {
  apiKey?: string;
  voice?: string;
}

export interface TtsSynthesizeRequest {
  text: string;
  language: LanguageCode;
  audioFormat: AudioFormat;
  /** Override the provider-level default voice for this request. */
  voice?: string;
}

export interface TtsProvider {
  readonly name: string;
  /**
   * MIME type of the container `synthesize` emits (e.g. `audio/mpeg`,
   * `audio/wav`). Lives on the provider so consumers never maintain their own
   * provider→format mapping.
   */
  readonly outputMimeType: string;
  /** Synthesize the full text and return the audio bytes. */
  synthesize(req: TtsSynthesizeRequest): Promise<Uint8Array>;
  /** Optional streaming variant — chunks delivered via callback as they arrive. */
  synthesizeStream?(
    req: TtsSynthesizeRequest,
    onChunk: (chunk: Uint8Array) => void,
  ): Promise<StreamHandle>;
}
