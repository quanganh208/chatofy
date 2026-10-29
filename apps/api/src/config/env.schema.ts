import { z } from 'zod';

/**
 * Wraps an optional schema so an empty-string env var is treated as "unset".
 * dotenv and .env.example commonly ship `KEY=` placeholders; without this,
 * an empty string is a present value and fails checks like `.min(1)`/`.url()`.
 */
const emptyStringAsUndefined = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema);

/**
 * The port `apps/web` actually runs on in dev. Exported so main.ts's
 * production boot check compares WEB_BASE_URL against the exact same string
 * this schema defaults it to, rather than repeating the literal.
 */
export const DEFAULT_WEB_BASE_URL = 'http://localhost:3001';

/**
 * Zod schema for all required/optional environment variables.
 *
 * Exported so `.env.example` can be checked against it rather than kept in step
 * by hand: the keys here and the keys documented there drifted once already,
 * and a default written as a live line in the example is a value every copy of
 * that file then overrides for no reason. See env.schema.spec.ts.
 */
export const envSchema = z.object({
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
  // Where the rotating refresh-token families live. DEFAULTED, not required:
  // the default is the port docker-compose publishes, and a required value
  // would break every e2e suite's env setup at once for a service they all
  // reach through the same local compose stack.
  //
  // A wrong or unreachable value does NOT stop the boot — see RedisModule. It
  // surfaces as a 503 from POST /auth/refresh, never as a 401, because a 401 is
  // read by every client as proof the session is dead.
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  // Origins allowed to call this API with credentials. UNSET means the web
  // origin, WEB_BASE_URL — the only browser client — so a deployment states its
  // origin once. Set it only to allow more origins (comma-separated) or `*`.
  CORS_ORIGIN: emptyStringAsUndefined(z.string().min(1).optional()),
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
  // The web's Google client id — the same name Auth.js reads. With no
  // GOOGLE_CLIENT_IDS the API accepts exactly this client, so the one prod.env
  // both apps share needs the id written once.
  AUTH_GOOGLE_ID: emptyStringAsUndefined(z.string().min(1).optional()),

  // ── Mail (Gmail SMTP) ───────────────────────────────────────────────────
  // Host and port default to Gmail over SMTPS, the only relay this app uses.
  // SMTP_USER and SMTP_PASS are what switch real mail on: OPTIONAL and lazily
  // enforced, matching GOOGLE_CLIENT_IDS, because a deployment that never sends
  // mail (all of dev, most of test) should not be stopped from booting over
  // values it has no use for. MailModule reads the four as one unit — see
  // getSmtpConfig in mail.module.ts — and falls back to a console or no-op
  // sender when the credentials are missing.
  SMTP_HOST: emptyStringAsUndefined(
    z.string().min(1).default('smtp.gmail.com'),
  ),
  SMTP_PORT: emptyStringAsUndefined(
    z.coerce.number().int().positive().default(465),
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

  // ── Turn-based translate pipeline ───────────────────────────────────────
  // Provider selections for the REST /translate flow. Speech runs locally by
  // default (sherpa-onnx sidecars, no cloud call, no API key); translation is
  // cloud DeepSeek through the OpenAI-compatible provider (`gemini` switches it
  // back). Set the speech pair to `elevenlabs` to compare against the cloud.
  AI_STT_PROVIDER: z.string().default('local'),
  AI_TTS_PROVIDER: z.string().default('local'),
  AI_TRANSLATION_PROVIDER: z.string().default('deepseek'),
  // Keys are OPTIONAL at validation time so the app and existing e2e tests can
  // boot without them; the providers factory enforces presence lazily and
  // returns a clear error when /translate is actually called without a key.
  ELEVENLABS_API_KEY: emptyStringAsUndefined(z.string().min(1).optional()),
  // One key, or several comma-separated: the translator rotates across them.
  // Gemini meters quota per PROJECT per model, so several keys only raise the
  // ceiling when they come from different Google Cloud projects — see
  // apps/api/.env.example.
  GEMINI_API_KEY: emptyStringAsUndefined(z.string().min(1).optional()),
  // The credential for whichever OpenAI-compatible host `AI_TRANSLATION_PROVIDER`
  // names — `deepseek`, `openai`, or any later row of the table in
  // `register-default-providers.ts`.
  //
  // ONE variable for the whole family rather than one per host, because exactly
  // one translation provider is ever selected: a per-host variable would mean
  // every deployment carrying a column of blanks for the hosts it did not
  // choose, and the env growing by a line each time the table does.
  //
  // GEMINI_API_KEY above is NOT the same kind of thing and deliberately stays
  // separate: it is not a translation key. It also authenticates the realtime
  // and summarization providers, which are selected independently of this one,
  // so folding it in here would tie three unrelated choices to one line.
  OPENAI_COMPATIBLE_API_KEY: emptyStringAsUndefined(
    z.string().min(1).optional(),
  ),
  // The Command Code plan's key, for `AI_TRANSLATION_PROVIDER=commandcode`.
  //
  // Its own variable, against the reasoning above, because that provider is the
  // one selection that calls TWO hosts: Command Code first, and the DeepSeek
  // row as the fallback, which still reads OPENAI_COMPATIBLE_API_KEY. One
  // variable cannot hold two hosts' keys.
  COMMAND_CODE_API_KEY: emptyStringAsUndefined(z.string().min(1).optional()),
  // Which registered summarizer writes meeting minutes: `commandcode` (Command
  // Code's gemini-3.7-flash, Gemini direct behind it) or `gemini` (Gemini
  // direct). Unset, it follows AI_TRANSLATION_PROVIDER — `commandcode` there
  // means `commandcode` here, anything else `gemini` — so a deployment that only
  // moved translation keeps today's minutes. No model variable beside it: each
  // entry owns its endpoint and model, for the reason the host table gives.
  AI_SUMMARIZATION_PROVIDER: emptyStringAsUndefined(
    z.enum(['commandcode', 'gemini']).optional(),
  ),
  // Local speech sidecars (services/local-stt, services/local-tts). Each serves
  // both vi and en and picks its engine from the language it is given, so there
  // is no per-language URL. Default voices belong to the sidecars, since the
  // meaning of a voice differs per engine.
  LOCAL_STT_URL: z.string().url().default('http://localhost:8002'),
  LOCAL_TTS_URL: z.string().url().default('http://localhost:8003'),

  // Whether /ws/translate offers continuous speech-to-speech (`client.live.start`,
  // one Gemini Live session per socket). Meetings and the translate page run the
  // turn cascade; live mode stays only for the live e2e and the
  // benchmarks/live-translate harness, which run against a dev API.
  //
  // OPTIONAL with no schema default, because the default depends on NODE_ENV —
  // see liveModeEnabled below. Fail-closed: unset means on only for exactly
  // development or test, so a production image (NODE_ENV=production from the
  // Dockerfile) refuses live starts with no prod.env line. `enabled` turns it
  // back on anywhere, which is the rollback; `disabled` turns it off in dev, for
  // a host-run API pointed at production keys.
  //
  // An enum, not a boolean: `z.coerce.boolean()` reads the string "false" as true.
  TRANSLATE_LIVE_MODE: emptyStringAsUndefined(
    z.enum(['enabled', 'disabled']).optional(),
  ),

  // ── Video conferencing (Cloudflare Realtime SFU) ──────────────────────────
  // Media goes from each client straight to Cloudflare Realtime SFU; the API
  // holds the app secret and drives the SFU over outbound HTTPS.
  //
  // The Realtime SFU app (dashboard: Realtime > Serverless SFU). REQUIRED in
  // effect: meetings always load, and CloudflareRealtimeClient refuses to
  // construct without both, which fails the boot. Optional in the schema only so
  // that refusal carries a message naming the feature.
  CLOUDFLARE_REALTIME_APP_ID: emptyStringAsUndefined(
    z.string().min(1).optional(),
  ),
  CLOUDFLARE_REALTIME_APP_SECRET: emptyStringAsUndefined(
    z.string().min(1).optional(),
  ),
  // A Realtime TURN key (dashboard: Realtime > TURN Server). TURN is on only
  // when BOTH are set: each join then gets short-lived TURN credentials beside
  // Cloudflare's STUN, for networks that block UDP. Free when used with the SFU.
  CLOUDFLARE_TURN_KEY_ID: emptyStringAsUndefined(z.string().min(1).optional()),
  CLOUDFLARE_TURN_KEY_API_TOKEN: emptyStringAsUndefined(
    z.string().min(1).optional(),
  ),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Whether this server answers `client.live.start` with a live session.
 *
 * An explicit TRANSLATE_LIVE_MODE wins. Unset, live is on only when NODE_ENV is
 * exactly `development` or `test` — the same fail-closed rule MailModule uses to
 * pick its console sender — never "anything but production", so a NODE_ENV this
 * code does not know falls on the safe side.
 *
 * A function beside the schema rather than a cross-field `.transform`, so the
 * schema stays a plain object whose shape env.schema.spec.ts can walk.
 */
export function liveModeEnabled(
  env: Pick<Env, 'NODE_ENV' | 'TRANSLATE_LIVE_MODE'>,
): boolean {
  if (env.TRANSLATE_LIVE_MODE !== undefined) {
    return env.TRANSLATE_LIVE_MODE === 'enabled';
  }
  return env.NODE_ENV === 'development' || env.NODE_ENV === 'test';
}

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
