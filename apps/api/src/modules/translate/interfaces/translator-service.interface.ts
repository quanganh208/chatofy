/**
 * Provider-agnostic real-time translator service contract.
 * Concrete impl delegates to @chatofy/ai-providers registry.
 * Bind via TRANSLATOR_SERVICE injection token for swappability.
 */

export const TRANSLATOR_SERVICE = Symbol('TRANSLATOR_SERVICE');

export interface StreamConfig {
  /** BCP-47 source language tag, e.g. 'vi', 'en'. */
  sourceLanguage: string;
  /** BCP-47 target language tag. */
  targetLanguage: string;
  /** Client session ID for correlation. */
  sessionId: string;
}

export interface StreamHandle {
  /** Opaque stream identifier returned to the gateway. */
  streamId: string;
}

export interface TranslatorService {
  /**
   * Open a streaming translation session.
   * Returns a StreamHandle with a streamId for subsequent audio frames.
   */
  startStream(clientId: string, config: StreamConfig): Promise<StreamHandle>;

  /**
   * Feed a raw audio frame (PCM16 chunk) into an open stream.
   * Emits translated text/audio back through the WebSocket gateway.
   */
  handleAudioFrame(streamId: string, frame: Buffer): Promise<void>;

  /** Flush pending audio and close the stream. */
  endStream(streamId: string): Promise<void>;
}
