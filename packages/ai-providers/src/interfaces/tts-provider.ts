// TtsProvider contract — text-to-speech synthesis (e.g. ElevenLabs, OpenAI TTS)
import type {
  AudioFormat,
  LanguageCode,
  ProviderConfig,
  StreamHandle,
  VoiceGender,
} from './provider-types.js';

export interface TtsProviderConfig extends ProviderConfig {
  apiKey?: string;
  voice?: string;
}

export interface TtsSynthesizeRequest {
  text: string;
  language: LanguageCode;
  audioFormat: AudioFormat;
  /**
   * Which voice speaks the text. A gender rather than a voice name because
   * this contract spans backends that share no vocabulary for naming voices —
   * each one maps the gender onto whatever it addresses voices by.
   */
  voiceGender?: VoiceGender;
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
