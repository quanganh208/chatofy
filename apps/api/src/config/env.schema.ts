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
export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: emptyStringAsUndefined(z.string().url().optional()),
  AUTH_PROVIDER: authProviderSchema.default('none'),
  AI_REALTIME_PROVIDER: z.string().default('none'),
  CORS_ORIGIN: z.string().default('*'),

  // ── Turn-based translate pipeline (vi→en) ──────────────────────────────
  // Provider selections for the REST /translate flow. STT/TTS via ElevenLabs,
  // translation via Gemini by default.
  AI_STT_PROVIDER: z.string().default('elevenlabs'),
  AI_TTS_PROVIDER: z.string().default('elevenlabs'),
  AI_TRANSLATION_PROVIDER: z.string().default('gemini'),
  // Keys are OPTIONAL at validation time so the app and existing e2e tests can
  // boot without them; the providers factory enforces presence lazily and
  // returns a clear error when /translate is actually called without a key.
  ELEVENLABS_API_KEY: emptyStringAsUndefined(z.string().min(1).optional()),
  GEMINI_API_KEY: emptyStringAsUndefined(z.string().min(1).optional()),
  // Default English voice for TTS (ElevenLabs "Rachel"); override per deployment.
  ELEVENLABS_TTS_VOICE_ID: z.string().default('21m00Tcm4TlvDq8ikWAM'),
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
