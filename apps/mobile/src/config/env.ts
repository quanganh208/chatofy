import { z } from 'zod';

// Validate all EXPO_PUBLIC_* env vars at module load — fail fast if misconfigured
const envSchema = z.object({
  EXPO_PUBLIC_API_BASE_URL: z.string().url('EXPO_PUBLIC_API_BASE_URL must be a valid URL'),
  EXPO_PUBLIC_WS_URL: z.string().min(1, 'EXPO_PUBLIC_WS_URL is required'),
  EXPO_PUBLIC_ENV: z.enum(['development', 'staging', 'production']),
});

const parsed = envSchema.safeParse({
  EXPO_PUBLIC_API_BASE_URL: process.env.EXPO_PUBLIC_API_BASE_URL,
  EXPO_PUBLIC_WS_URL: process.env.EXPO_PUBLIC_WS_URL,
  EXPO_PUBLIC_ENV: process.env.EXPO_PUBLIC_ENV,
});

if (!parsed.success) {
  throw new Error(
    `Invalid environment variables:\n${parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n')}`,
  );
}

export type AppEnv = z.infer<typeof envSchema>;

export const env: AppEnv = parsed.data;
