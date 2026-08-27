import { z } from 'zod';

// Zod schema for validated environment variables.
// NEXT_PUBLIC_* vars are inlined at build time — access via process.env directly.
// Defaults keep `next build` (which prerenders pages with no runtime env) and
// local dev hermetic; real deployments set these explicitly. An *invalid* value
// (e.g. a non-URL) still fails fast — only an absent var falls back.
const envSchema = z.object({
  NEXT_PUBLIC_API_BASE_URL: z.string().url().default('http://localhost:3000'),
  NEXT_PUBLIC_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  // The origin avatars are served from — the R2 bucket's public custom domain.
  // Optional: with it unset the API composes no avatar URL, the CSP names no
  // extra origin, and every surface falls back to initials.
  //
  // BUILD-time, like NEXT_PUBLIC_API_BASE_URL: `next.config.ts` bakes it into
  // the CSP header, so changing it is a rebuild rather than a restart.
  NEXT_PUBLIC_AVATAR_BASE_URL: z.string().url().optional(),
});

export type WebEnv = z.infer<typeof envSchema>;

// Validate at module load time; throws at startup if env is misconfigured.
export const env: WebEnv = envSchema.parse({
  NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
  NEXT_PUBLIC_ENV: process.env.NEXT_PUBLIC_ENV,
  NEXT_PUBLIC_AVATAR_BASE_URL: process.env.NEXT_PUBLIC_AVATAR_BASE_URL,
});
