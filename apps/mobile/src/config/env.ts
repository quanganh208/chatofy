// Environment config — reads EXPO_PUBLIC_* vars and validates at module load time.
// Any missing required var throws immediately so crashes surface early, not at runtime.
import { z } from 'zod';

const envSchema = z.object({
  EXPO_PUBLIC_API_BASE_URL: z.string().url('EXPO_PUBLIC_API_BASE_URL must be a valid URL'),
  EXPO_PUBLIC_WS_URL: z.string().min(1, 'EXPO_PUBLIC_WS_URL is required'),
  EXPO_PUBLIC_ENV: z.enum(['development', 'staging', 'production']).default('development'),
});

// process.env is statically inlined by Metro bundler for EXPO_PUBLIC_* keys
const parsed = envSchema.safeParse({
  EXPO_PUBLIC_API_BASE_URL: process.env['EXPO_PUBLIC_API_BASE_URL'],
  EXPO_PUBLIC_WS_URL: process.env['EXPO_PUBLIC_WS_URL'],
  EXPO_PUBLIC_ENV: process.env['EXPO_PUBLIC_ENV'],
});

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`[env] Invalid environment variables:\n${issues}`);
}

export type AppEnv = z.infer<typeof envSchema>;

export const env: AppEnv = parsed.data;
