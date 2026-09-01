import { z } from 'zod';

/**
 * Wraps an optional schema so an empty-string env var is treated as "unset".
 * dotenv and .env.example commonly ship `KEY=` placeholders; without this,
 * an empty string is a present value and fails checks like `.min(1)`/`.url()`.
 */
const emptyStringAsUndefined = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema);

/**
 * An env var read as an on/off switch.
 *
 * NOT `z.coerce.boolean()`. That is `Boolean(value)`, and every non-empty string
 * is truthy — so `KEY=false` reads as ON, which is the exact opposite of what
 * the line says, and the failure is silent: a switch shipped in the off position
 * turns the feature on. Only the four words below are accepted, and anything
 * else fails validation at boot rather than being quietly guessed at.
 *
 * An empty value (`KEY=`) means unset and takes the default, matching
 * {@link emptyStringAsUndefined} and the `.env.example` placeholder convention.
 */
const booleanFromEnv = (fallback: boolean) =>
  z.preprocess(
    (value) => (value === '' || value === undefined ? fallback : value),
    z.union([
      z.boolean(),
      z
        .enum(['true', 'false', '1', '0'])
        .transform((value) => value === 'true' || value === '1'),
    ]),
  );

/**
 * The port `apps/web` actually runs on in dev. Exported so main.ts's
 * production boot check compares WEB_BASE_URL against the exact same string
 * this schema defaults it to, rather than repeating the literal.
 */
export const DEFAULT_WEB_BASE_URL = 'http://localhost:3001';

/** Zod schema for all required/optional environment variables. */
const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  // Signs and verifies every access token the API issues. REQUIRED — there is no
  // "auth off" mode, so a missing secret must stop the boot rather than silently
  // produce a deployment that mints unverifiable tokens. 32 chars is the floor
  // for the HS256 key; `openssl rand -base64 32` clears it.
  AUTH_JWT_SECRET: z.string().min(32),
  CORS_ORIGIN: z.string().default('*'),
  // How many reverse proxies sit in front of this app.
  //
  // 0 (the default) means none: Express reads the peer socket address as the
  // client IP, which is correct when the port is exposed directly. Behind an
  // ingress or a CDN it is the PROXY's address for every request, so the
  // per-IP auth rate limit collapses into one global bucket and the eleventh
  // login attempt anywhere denies login to everyone.
  //
  // A COUNT, never a boolean. `trust proxy: true` makes X-Forwarded-For
  // attacker-controlled, and a limiter keyed on a spoofable value is no
  // limiter — set it to the exact number of hops you operate.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),
  // Every OAuth client id allowed to mint an id_token this API will accept,
  // comma-separated — web today, per-platform mobile ids later. OPTIONAL at
  // validation time and enforced when POST /auth/google is called, matching
  // GEMINI_API_KEY: a deployment that never offers Google login should not be
  // stopped from booting over a value it has no use for.
  GOOGLE_CLIENT_IDS: emptyStringAsUndefined(z.string().min(1).optional()),

  // ── Mail (Gmail SMTP) ───────────────────────────────────────────────────
  // All four OPTIONAL and lazily enforced, matching GOOGLE_CLIENT_IDS: a
  // deployment that never sends mail (all of dev, most of test) should not
  // be stopped from booting over values it has no use for. MailModule reads
  // them as one unit — see getSmtpConfig in mail.module.ts — and falls back
  // to a console or no-op sender when any is missing.
  SMTP_HOST: emptyStringAsUndefined(z.string().min(1).optional()),
  SMTP_PORT: emptyStringAsUndefined(
    z.coerce.number().int().positive().optional(),
  ),
  SMTP_USER: emptyStringAsUndefined(z.string().min(1).optional()),
  SMTP_PASS: emptyStringAsUndefined(z.string().min(1).optional()),
  // Display-name override only, e.g. `"Chatofy" <SMTP_USER value>`. Gmail
  // rewrites the `From` address to the authenticated SMTP_USER regardless,
  // so a different address here is silently discarded by Gmail, not by this
  // app — see SmtpMailSender.
  MAIL_FROM: emptyStringAsUndefined(z.string().min(1).optional()),

  // Origin every mailed link is built from — verification, reset, and the
  // "you already have an account" notice. NEVER derive this from a request's
  // Host header instead: that turns a wrong or attacker-supplied Host into
  // host-header link poisoning baked into a signed, mailed URL. The default
  // fixes local dev; it does not fix production, where main.ts's boot check
  // refuses to start if this is still the default (see DEFAULT_WEB_BASE_URL).
  WEB_BASE_URL: z.string().url().default(DEFAULT_WEB_BASE_URL),

  // ── Avatar storage (Cloudflare R2) ─────────────────────────────────────
  // The public origin avatars are SERVED from — a custom domain attached to the
  // bucket. Not derivable from the account id: the r2.cloudflarestorage.com
  // endpoint is the S3 API and is not publicly readable.
  //
  // Here rather than with the other R2_* keys because the response mapper is the
  // first thing that reads it — `toUserContract` composes an avatar URL from the
  // stored key and this base. The four credentials/bucket keys arrive with the
  // storage module. `validateEnv` returns only parsed schema keys and every
  // consumer reads through `ConfigService<Env, true>`, so a key absent from this
  // schema is not readable at all.
  R2_PUBLIC_BASE_URL: emptyStringAsUndefined(z.string().url().optional()),
  // The S3-compatible credentials and target bucket. All OPTIONAL and read as
  // ONE unit — see getR2Config in storage.module.ts — matching the SMTP block: a
  // deployment that never stores avatars (all of dev, most of test) should not be
  // stopped from booting over values it has no use for, and a PARTIAL set
  // disables the feature rather than producing a client that can put but never
  // compose a URL.
  //
  // `R2_ACCOUNT_ID` builds the S3 endpoint, which is NOT publicly readable;
  // `R2_PUBLIC_BASE_URL` above is the separate custom domain avatars are served
  // from. Both are needed, and they are not derivable from each other.
  R2_ACCOUNT_ID: emptyStringAsUndefined(z.string().min(1).optional()),
  R2_ACCESS_KEY_ID: emptyStringAsUndefined(z.string().min(1).optional()),
  R2_SECRET_ACCESS_KEY: emptyStringAsUndefined(z.string().min(1).optional()),
  R2_BUCKET: emptyStringAsUndefined(z.string().min(1).optional()),

  // ── Turn-based translate pipeline (vi↔en) ──────────────────────────────
  // Provider selections for the REST /translate flow. Speech runs locally by
  // default (sherpa-onnx sidecars, no cloud call, no API key); translation is
  // still cloud Gemini. Set these to `elevenlabs` to compare against the cloud.
  AI_STT_PROVIDER: z.string().default('local'),
  AI_TTS_PROVIDER: z.string().default('local'),
  AI_TRANSLATION_PROVIDER: z.string().default('gemini'),
  // Keys are OPTIONAL at validation time so the app and existing e2e tests can
  // boot without them; the providers factory enforces presence lazily and
  // returns a clear error when /translate is actually called without a key.
  ELEVENLABS_API_KEY: emptyStringAsUndefined(z.string().min(1).optional()),
  // One key, or several comma-separated: the translator rotates across them.
  // Gemini meters quota per PROJECT per model, so several keys only raise the
  // ceiling when they come from different Google Cloud projects — see
  // apps/api/.env.example.
  GEMINI_API_KEY: emptyStringAsUndefined(z.string().min(1).optional()),
  // Which ElevenLabs voice speaks the translation. Unset on purpose: the
  // provider owns its own default, for the same reason the sidecars below own
  // theirs — what a voice id means is the backend's vocabulary, not this
  // schema's, and duplicating the value here only creates two places to change.
  ELEVENLABS_TTS_VOICE_ID: emptyStringAsUndefined(z.string().min(1).optional()),
  // Local speech sidecars (services/local-stt, services/local-tts). Each serves
  // both vi and en and picks its engine from the language it is given, so there
  // is no per-language URL. Default voices belong to the sidecars, since the
  // meaning of a voice differs per engine.
  /**
   * Master switch for per-turn speaker embeddings.
   *
   * Off until the browser's audio processing has been measured: every threshold
   * the client scores against was calibrated on corpus audio that never passed
   * through `noiseSuppression` or `autoGainControl`, both of which reshape the
   * timbre an embedding reads. With it off no embedding is requested and no
   * event is sent, whatever a client asks for.
   *
   * The client's own `embedSpeaker` is the other half; both must be on.
   *
   * Read with {@link booleanFromEnv}, so the `SPEAKER_EMBEDDING_ENABLED=false`
   * that `prod.env.example` ships actually means off.
   */
  SPEAKER_EMBEDDING_ENABLED: booleanFromEnv(false),
  LOCAL_STT_URL: z.string().url().default('http://localhost:8002'),
  LOCAL_TTS_URL: z.string().url().default('http://localhost:8003'),
  // Where to append one JSON line per streamed turn, timed stage by stage.
  // Unset means no file is written — a latency table is something you collect
  // deliberately, not a file the API grows on every deployment.
  TURN_METRICS_PATH: emptyStringAsUndefined(z.string().min(1).optional()),

  // ── Meeting minutes ────────────────────────────────────────────────────
  // Which store backs generated minutes. Defaults to `memory` so the app and
  // the non-DB e2e suite boot without a minutes table: the in-memory store is a
  // correct default for the current client-submits-the-transcript flow. Set
  // `prisma` in a deployment that must let minutes outlive a restart or be read
  // on another instance. Keyed on an explicit switch rather than on
  // DATABASE_URL presence, because the DB is configured for users regardless of
  // whether minutes should be persisted.
  MINUTES_STORE_BACKEND: z.enum(['memory', 'prisma']).default('memory'),

  // ── Glossary ───────────────────────────────────────────────────────────
  // Which store backs a user's domain-term glossary. Same switch pattern as
  // MINUTES_STORE_BACKEND: defaults to `memory` so the app and the non-DB e2e
  // suite boot without a glossary table; a deployment sets `prisma` to make a
  // user's glossary durable across restarts and instances.
  GLOSSARY_STORE_BACKEND: z.enum(['memory', 'prisma']).default('memory'),
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
