import { z } from 'zod';

// Zod schema for validated environment variables.
// NEXT_PUBLIC_* vars are inlined at build time — access via process.env directly.
// Defaults keep `next build` (which prerenders pages with no runtime env) and
// local dev hermetic; real deployments set these explicitly. An *invalid* value
// (e.g. a non-URL) still fails fast — only an absent var falls back.
/**
 * Where this app dials the API when nothing says otherwise.
 *
 * Exported so `next.config.ts` composes the CSP `connect-src` from the SAME
 * string this schema defaults to. It held its own copy of the literal, and the
 * two drifting apart is not a cosmetic bug: the app would dial the new origin
 * while the header baked at build time still named the old one, and the browser
 * would block every request and every socket.
 */
export const DEFAULT_API_BASE_URL = 'http://localhost:3000';

export const envSchema = z.object({
  NEXT_PUBLIC_API_BASE_URL: z.string().url().default(DEFAULT_API_BASE_URL),
});

export type WebEnv = z.infer<typeof envSchema>;

// Validate at module load time; throws at startup if env is misconfigured.
export const env: WebEnv = envSchema.parse({
  NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
});
