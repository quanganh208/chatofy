/** DI injection token for the translator service. */
export const TRANSLATOR_SERVICE = Symbol('TRANSLATOR_SERVICE');

/** Configuration passed when opening a new translation stream. */
export interface StreamConfig {
  sourceLang: string;
  targetLang: string;
  /** Client-supplied session id for correlation. */
  sessionId: string;
}

/** Opaque handle returned by startStream — used to route subsequent frames. */
export interface StreamHandle {
  streamId: string;
}

/**
 * Backend-agnostic translator service interface.
 * Implementations delegate to @chatofy/ai-providers registry.
 * Default impl: NoopTranslatorService (stub).
 */
export interface TranslatorService {
  startStream(clientId: string, config: StreamConfig): Promise<StreamHandle>;
  handleAudioFrame(streamId: string, frame: Buffer): Promise<void>;
  endStream(streamId: string): Promise<void>;
}
