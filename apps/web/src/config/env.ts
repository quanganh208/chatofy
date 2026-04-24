// Validates NEXT_PUBLIC_* env vars at module load time — fails fast on misconfiguration
import { z } from 'zod';

const envSchema = z.object({
  NEXT_PUBLIC_API_BASE_URL: z.string().url({
    message: 'NEXT_PUBLIC_API_BASE_URL must be a valid URL (e.g. http://localhost:3000)',
  }),
  NEXT_PUBLIC_ENV: z.enum(['development', 'staging', 'production'], {
    errorMap: () => ({
      message: 'NEXT_PUBLIC_ENV must be one of: development, staging, production',
    }),
  }),
});

const _parsed = envSchema.safeParse({
  NEXT_PUBLIC_API_BASE_URL: process.env['NEXT_PUBLIC_API_BASE_URL'],
  NEXT_PUBLIC_ENV: process.env['NEXT_PUBLIC_ENV'],
});

if (!_parsed.success) {
  console.error('[env] Invalid environment variables:\n', _parsed.error.format());
  throw new Error('[env] Invalid environment variables — check .env.example');
}

/** Validated, typed environment variables for the web app */
export const env = _parsed.data;

/** Type of the validated env object */
export type WebEnv = typeof env;
