// TtsProvider contract — text-to-speech synthesis (e.g. ElevenLabs, OpenAI TTS)
import type { AudioFormat, LanguageCode, ProviderConfig, VoiceGender } from './provider-types.js';

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
  /**
   * Speaking rate, 0.5–2, where 1 is the voice's natural pace.
   *
   * Optional because it is not universally supported and a provider that cannot
   * honour it must IGNORE it rather than fail — the same rule this contract
   * already applies to an unrecognised `voiceGender`. Callers must not assume the
   * spoken output changed; whether it did is a property of the running backend.
   */
  speed?: number;
}

/** One voice a backend offers, as a caller sees it. */
export interface TtsVoice {
  /**
   * How this backend addresses the voice. OPAQUE outside the provider that
   * produced it: an integer id to one engine, a preset name to another, and
   * meaningless to a third.
   */
  token: string;
  /** Human-readable, written by someone who listened to it. */
  label: string;
  gender: VoiceGender;
}

export interface TtsProvider {
  readonly name: string;
  /**
   * MIME type of the container `synthesize` emits (e.g. `audio/mpeg`,
   * `audio/wav`). Lives on the provider so consumers never maintain their own
   * provider→format mapping.
   */
  readonly outputMimeType: string;
  /**
   * The voices this backend offers for a language, if it offers a choice at all.
   *
   * OPTIONAL, and its absence is meaningful: a provider that does not implement
   * it advertises no voices, so nothing may send it a voice token. That is the
   * gate — a token only ever reaches the provider that listed it.
   *
   * **`TtsSynthesizeRequest` deliberately carries no voice field.** Its absence
   * is a structural guarantee rather than a convention: a provider that
   * interpolates configuration into a request path cannot be handed a
   * client-chosen value even by mistake. Widening this interface would restore
   * exactly the channel that once made every Vietnamese turn fail — a voice name
   * meant for one backend was interpolated into another's URL, returning 404 and
   * surfacing as 503. A provider that accepts a voice takes it on its OWN request
   * type, and must treat an unrecognised one as absent rather than pass it
   * onward.
   */
  listVoices?(language: LanguageCode): Promise<TtsVoice[]>;
  /** Synthesize the full text and return the audio bytes. */
  synthesize(req: TtsSynthesizeRequest): Promise<Uint8Array>;
  /**
   * The same synthesis, delivered as the backend produces it.
   *
   * OPTIONAL, like `listVoices`: a caller that finds it absent — or gets `null`
   * back — synthesizes with `synthesize` instead. `null` means THIS deployment
   * of the backend has no stream (an older sidecar, say), which is a fallback
   * rather than a failure.
   *
   * Resolves once the first audio exists, so the time it takes is the time to
   * first audio. Headerless PCM rather than a container, because a stream has
   * no length to write into a header before its last sample.
   *
   * `signal` belongs to the caller: aborting it ends the request and the
   * iteration with `ProviderAbortedError`, which is distinct from a timeout on
   * purpose — a listener who left and a backend that hung are different events
   * and are recorded differently.
   */
  synthesizeStream?(req: TtsSynthesizeRequest, signal: AbortSignal): Promise<TtsAudioStream | null>;
}

/** Speech as it is synthesized: 16-bit little-endian mono PCM. */
export interface TtsAudioStream {
  encoding: 'pcm16';
  sampleRate: number;
  /**
   * Arbitrary-sized byte chunks, NOT sample-aligned: a network chunk can end
   * halfway through a sample, and the consumer carries the odd byte over.
   * Ends normally only when synthesis finished; a failure part-way throws.
   */
  chunks: AsyncIterable<Uint8Array>;
}
