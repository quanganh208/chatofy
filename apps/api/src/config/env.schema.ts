import { z } from 'zod';

// Zod schema for all required/optional environment variables.
// Called by ConfigModule.forRoot({ validate }) at bootstrap — throws on invalid env.
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().optional(),
  CORS_ORIGIN: z.string().default('*'),
  AUTH_PROVIDER: z.enum(['none', 'supabase', 'better-auth', 'custom']).default('none'),
  AI_REALTIME_PROVIDER: z.string().default('none'),
  AI_STT_PROVIDER: z.string().default('none'),
  AI_TRANSLATION_PROVIDER: z.string().default('none'),
  AI_TTS_PROVIDER: z.string().default('none'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Validates raw process.env against envSchema.
 * Passed directly to ConfigModule.forRoot({ validate }).
 * Throws ZodError (converted to Error message) on invalid input — halts boot.
 */
export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    const formatted = result.error.errors
      .map((e) => `  [${e.path.join('.')}] ${e.message}`)
      .join('\n');
    throw new Error(`Environment validation failed:\n${formatted}`);
  }
  return result.data;
}
