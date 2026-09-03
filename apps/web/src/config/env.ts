import { z } from 'zod';

// Zod schema for validated environment variables.
// NEXT_PUBLIC_* vars are inlined at build time — access via process.env directly.
// Defaults keep `next build` (which prerenders pages with no runtime env) and
// local dev hermetic; real deployments set these explicitly. An *invalid* value
// (e.g. a non-URL) still fails fast — only an absent var falls back.
const envSchema = z.object({
  NEXT_PUBLIC_API_BASE_URL: z.string().url().default('http://localhost:3000'),
});

export type WebEnv = z.infer<typeof envSchema>;

// Validate at module load time; throws at startup if env is misconfigured.
export const env: WebEnv = envSchema.parse({
  NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
});
