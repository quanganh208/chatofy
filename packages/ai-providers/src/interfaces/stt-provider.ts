// SttProvider contract — speech-to-text. Batch transcription is the required
// core (turn-based flow); streaming is an optional future path. Mirrors the
// TtsProvider shape (required batch method + optional stream method).
import type { AudioFormat, LanguageCode, ProviderConfig, StreamHandle } from './provider-types.js';

export interface SttProviderConfig extends ProviderConfig {
  apiKey?: string;
  model?: string;
}

/** Result of transcribing a complete utterance. */
export interface SttTranscriptResult {
  text: string;
  language: LanguageCode;
}

/** Streaming partial/final transcript event (future realtime path). */
export interface SttTranscriptEvent {
  text: string;
  isFinal: boolean;
  language: LanguageCode;
}

/** Options a backend may honour and others may ignore. */
export interface SttTranscribeOptions {
  /**
   * Which recognizer, when a backend serves one language with more than one.
   *
   * The local sidecar runs two Vietnamese engines: a causal one whose output is
   * spoken as it arrives, and a more accurate one for text a later read is
   * allowed to replace. A caller that knows which job it is doing says so;
   * absent means the backend's default. Backends with one engine per language
   * ignore this.
   */
  engine?: string;
}

/**
 * A causal decoding session: state the backend keeps between chunks.
 *
 * Distinct from {@link SttProvider.startStream} and not a replacement for it.
 * That one delivers partials that may be revised, which suits a screen. This one
 * promises the opposite and is the stronger claim: what {@link feed} returns is
 * only what became certain, so a caller appends and never takes anything back.
 * That is what makes it safe to synthesize a clause while the speaker is still
 * talking.
 */
export interface SttStreamSession {
  /**
   * Push raw PCM16 mono at 16 kHz; resolve with ONLY what this chunk finalized.
   *
   * The delta, never the running transcript. An empty string is the ordinary
   * answer for a chunk that finished no word.
   */
  feed(chunk: Uint8Array): Promise<string>;
  /** Flush the decoder's tail once the speaker has stopped. */
  finalize(): Promise<string>;
  /** Release the backend's state. Idempotent, because teardown runs twice. */
  close(): Promise<void>;
}

export interface SttProvider {
  readonly name: string;
  /** Batch transcription of a complete utterance — the turn-based core. */
  transcribe(
    audio: Uint8Array,
    mimeType: string,
    language: LanguageCode,
    options?: SttTranscribeOptions,
  ): Promise<SttTranscriptResult>;
  /**
   * Optional causal session, for text that will be spoken as it arrives.
   *
   * Absent means the backend cannot promise append-only output, which a caller
   * must treat as "do not speak this mid-turn" rather than as "try anyway".
   */
  openStream?(language: LanguageCode): Promise<SttStreamSession>;
  /** Optional streaming variant — partials delivered via callback. */
  startStream?(
    language: LanguageCode,
    audioFormat: AudioFormat,
    onTranscript: (event: SttTranscriptEvent) => void,
  ): Promise<StreamHandle>;
  pushAudio?(handle: StreamHandle, chunk: Uint8Array): Promise<void>;
}
