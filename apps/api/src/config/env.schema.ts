import { z } from 'zod';
// Provider allowlist is the shared contract's single source — so AUTH_PROVIDER
// can never be set to a value the public /auth/providers contract can't return.
import { authProviderSchema } from '@chatofy/types';

/** Zod schema for all required/optional environment variables. */
export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().optional(),
  AUTH_PROVIDER: authProviderSchema.default('none'),
  AI_REALTIME_PROVIDER: z.string().default('none'),
  CORS_ORIGIN: z.string().default('*'),
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
