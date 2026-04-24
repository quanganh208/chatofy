import { z } from 'zod';

// Zod schema for validated environment variables.
// NEXT_PUBLIC_* vars are inlined at build time — access via process.env directly.
const envSchema = z.object({
  NEXT_PUBLIC_API_BASE_URL: z.string().url(),
  NEXT_PUBLIC_ENV: z.enum(['development', 'staging', 'production']),
});

export type WebEnv = z.infer<typeof envSchema>;

// Validate at module load time; throws at startup if env is misconfigured.
export const env: WebEnv = envSchema.parse({
  NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
  NEXT_PUBLIC_ENV: process.env.NEXT_PUBLIC_ENV,
});
