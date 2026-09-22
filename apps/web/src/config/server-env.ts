import 'server-only';
import { z } from 'zod';

/**
 * Server-only configuration. Deliberately NOT in `src/config/env.ts`.
 *
 * That module runs `envSchema.parse(...)` at import time and is imported by
 * `'use client'` hooks, so a required non-`NEXT_PUBLIC_` key added there throws
 * a ZodError in the browser at module load — white-screening the translate page.
 * The obvious deadline fix for that is to mark the secret optional, which is
 * precisely the failure worth avoiding.
 *
 * `import 'server-only'` makes the mistake a build error instead of a runtime
 * one: importing this from a client component fails the build.
 */
export const serverEnvSchema = z.object({
  // Signs the session cookie. Auth.js reads AUTH_SECRET itself; it is validated
  // here so a missing one fails at boot with a readable message rather than as
  // an opaque decryption error on the first sign-in.
  AUTH_SECRET: z.string().min(1),
  // Optional: the Google button is offered only when both are present, which is
  // what Auth.js's own GET /api/auth/providers then reports.
  AUTH_GOOGLE_ID: z.string().min(1).optional(),
  AUTH_GOOGLE_SECRET: z.string().min(1).optional(),
  // This app's own public origin, for `metadataBase` — without it Next resolves
  // `og:image` against localhost and every shared link previews a dead image.
  // The api's OWN variable (it builds email links from it), shared rather than
  // mirrored, and read per request: every route is dynamic, so a deploy picks it
  // up from `prod.env` without a rebuild.
  WEB_BASE_URL: z.string().url().default('http://localhost:3001'),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

const emptyAsUndefined = (value: string | undefined) => (value === '' ? undefined : value);

export const serverEnv: ServerEnv = serverEnvSchema.parse({
  AUTH_SECRET: process.env.AUTH_SECRET,
  AUTH_GOOGLE_ID: emptyAsUndefined(process.env.AUTH_GOOGLE_ID),
  AUTH_GOOGLE_SECRET: emptyAsUndefined(process.env.AUTH_GOOGLE_SECRET),
  WEB_BASE_URL: emptyAsUndefined(process.env.WEB_BASE_URL),
});

/** Whether a Google button can work at all. Both halves or neither. */
export const googleConfigured =
  serverEnv.AUTH_GOOGLE_ID !== undefined && serverEnv.AUTH_GOOGLE_SECRET !== undefined;
