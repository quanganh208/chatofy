// Env-driven provider selection helper
// Reads AI_REALTIME_PROVIDER, AI_STT_PROVIDER, AI_TRANSLATION_PROVIDER, AI_TTS_PROVIDER
// from the supplied env map. Returns null for any unset key.

export interface AiProviderEnv {
  realtime?: string;
  stt?: string;
  translation?: string;
  tts?: string;
}

/**
 * Reads provider name selections from an environment variable map.
 * Designed to be called with `process.env` or a subset thereof.
 *
 * Example:
 *   const env = readAiProviderEnv(process.env);
 *   // env.stt === 'deepgram' when AI_STT_PROVIDER=deepgram
 */
export function readAiProviderEnv(env: Record<string, string | undefined>): AiProviderEnv {
  return {
    realtime: env['AI_REALTIME_PROVIDER'] ?? undefined,
    stt: env['AI_STT_PROVIDER'] ?? undefined,
    translation: env['AI_TRANSLATION_PROVIDER'] ?? undefined,
    tts: env['AI_TTS_PROVIDER'] ?? undefined,
  };
}
