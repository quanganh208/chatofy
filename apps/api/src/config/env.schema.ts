import { z } from 'zod';
// Provider allowlist is the shared contract's single source — so AUTH_PROVIDER
// can never be set to a value the public /auth/providers contract can't return.
import { authProviderSchema } from '@chatofy/types';

/**
 * Wraps an optional schema so an empty-string env var is treated as "unset".
 * dotenv and .env.example commonly ship `KEY=` placeholders; without this,
 * an empty string is a present value and fails checks like `.min(1)`/`.url()`.
 */
const emptyStringAsUndefined = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema);

/** Zod schema for all required/optional environment variables. */
const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  // Externally reachable base URL, for the startup log only. Unset means the
  // log falls back to the local listen address, which is right for local dev
  // and wrong behind a proxy — hence an override rather than a default here.
  APP_URL: emptyStringAsUndefined(z.string().url().optional()),
  DATABASE_URL: z.string().url(),
  AUTH_PROVIDER: authProviderSchema.default('none'),
  CORS_ORIGIN: z.string().default('*'),

  // ── Turn-based translate pipeline (vi↔en) ──────────────────────────────
  // Provider selections for the REST /translate flow. Speech runs locally by
  // default (sherpa-onnx sidecars, no cloud call, no API key); translation is
  // still cloud Gemini. Set these to `elevenlabs` to compare against the cloud.
  AI_STT_PROVIDER: z.string().default('local'),
  AI_TTS_PROVIDER: z.string().default('local'),
  AI_TRANSLATION_PROVIDER: z.string().default('gemini'),
  // Keys are OPTIONAL at validation time so the app and existing e2e tests can
  // boot without them; the providers factory enforces presence lazily and
  // returns a clear error when /translate is actually called without a key.
  ELEVENLABS_API_KEY: emptyStringAsUndefined(z.string().min(1).optional()),
  GEMINI_API_KEY: emptyStringAsUndefined(z.string().min(1).optional()),
  // Default English voice for TTS (ElevenLabs "Rachel"); override per deployment.
  ELEVENLABS_TTS_VOICE_ID: z.string().default('21m00Tcm4TlvDq8ikWAM'),
  // Local speech sidecars (services/local-stt, services/local-tts). Each serves
  // both vi and en and picks its engine from the language it is given, so there
  // is no per-language URL. Default voices belong to the sidecars, since the
  // meaning of a voice differs per engine.
  LOCAL_STT_URL: z.string().url().default('http://localhost:8002'),
  LOCAL_TTS_URL: z.string().url().default('http://localhost:8003'),
  // Where to append one JSON line per streamed turn, timed stage by stage.
  // Unset means no file is written — a latency table is something you collect
  // deliberately, not a file the API grows on every deployment.
  TURN_METRICS_PATH: emptyStringAsUndefined(z.string().min(1).optional()),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Validates process.env against envSchema.
 * Throws a descriptive error on first failure — used by ConfigModule.forRoot({ validate }).
 */
export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Environment validation failed:\n${issues}`);
  }
  return result.data;
}
