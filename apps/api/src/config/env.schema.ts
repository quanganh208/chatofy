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
  // The web's Google client id — the same name Auth.js reads — and the only
  // audience POST /auth/google accepts, so the env both apps share states it
  // once. OPTIONAL at validation time and enforced when the route is called: a
  // deployment that never offers Google login should not be stopped from
  // booting over a value it has no use for.
  AUTH_GOOGLE_ID: emptyStringAsUndefined(z.string().min(1).optional()),
  // The mobile app's Google client ids (one per platform: iOS and Android), comma-separated. An id_token issued to
  // one of them is accepted alongside the web's. Unset, only AUTH_GOOGLE_ID is.
  // Each id must be listed here by name: there is no wildcard.
  AUTH_GOOGLE_MOBILE_IDS: emptyStringAsUndefined(z.string().min(1).optional()),

  // ── Mail (Gmail SMTP) ───────────────────────────────────────────────────
  // Host and port default to Gmail over SMTPS, the only relay this app uses.
  // SMTP_USER and SMTP_PASS are what switch real mail on: OPTIONAL and lazily
  // enforced, matching AUTH_GOOGLE_ID, because a deployment that never sends
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
  // Provider selection for the REST /translate flow. Speech always runs in the
  // self-hosted sherpa-onnx sidecars (LOCAL_STT_URL / LOCAL_TTS_URL), so only
  // the translation host is selectable. It defaults to `commandcode`, what
  // production runs: Command Code first, the DeepSeek row behind it, so it
  // needs COMMAND_CODE_API_KEY AND OPENAI_COMPATIBLE_API_KEY. A missing key is
  // not failed over — it throws on first use — so a machine holding only the
  // OpenAI-compatible key selects `deepseek`.
  AI_TRANSLATION_PROVIDER: z.string().default('commandcode'),
  // Keys are OPTIONAL at validation time so the app and existing e2e tests can
  // boot without them; the providers factory enforces presence lazily and
  // returns a clear error when /translate is actually called without a key.
  // One key, or several comma-separated: the translator rotates across them.
  // Gemini meters quota per PROJECT per model, so several keys only raise the
  // ceiling when they come from different Google Cloud projects — see
  // docs/environment-variables.md.
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
  // separate: it is not a translation key. It also authenticates the
  // summarization provider, which is selected independently of this one, so
  // folding it in here would tie two unrelated choices to one line.
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

  // ── Translation cost knobs ────────────────────────────────────────────────
  // The defaults are the cheaper turn the replay measured against the baseline
  // (`benchmarks/call-budget`): about 54% of the calls and 59% of the billed
  // tokens, with the same final translations and p50 within 5%. Setting
  // `on`, `on`, `1` restores the turn as it was before. What each one trades is
  // on its field in `modules/translate/session/translation-cost-policy.ts`.
  TRANSLATE_SPECULATION_OVERLAP: emptyStringAsUndefined(
    z.enum(['on', 'off']).default('off'),
  ),
  TRANSLATE_SPECULATION_HOMOPHONES: emptyStringAsUndefined(
    z.enum(['on', 'off']).default('off'),
  ),
  TRANSLATE_LIVE_COMMIT_SCALE: emptyStringAsUndefined(
    z.coerce.number().min(1).max(4).default(3),
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

  // ── Billing (Polar and SePay) ─────────────────────────────────────────────
  // All OPTIONAL: a deployment without billing still boots, and a rail whose
  // secrets are missing reports itself `unavailable` (see rail-status.ts) rather
  // than failing at the first checkout.
  //
  // Who may check out at all: comma-separated emails, each compared through
  // `normalizeEmail`. Unset or empty means no one — checkout is not open to the
  // public, so the default is closed.
  BILLING_CHECKOUT_ALLOWLIST: emptyStringAsUndefined(
    z.string().min(1).optional(),
  ),
  // Which Polar environment: `sandbox` (sandbox-api.polar.sh, test cards) or
  // `live` (api.polar.sh, real money). The token and webhook secret must come
  // from the same environment.
  POLAR_MODE: emptyStringAsUndefined(
    z.enum(['sandbox', 'live']).default('sandbox'),
  ),
  // An organization access token (scopes checkouts:write, customer_sessions:write)
  // and the webhook endpoint's secret (`whsec_…`). Either missing: rail unavailable.
  POLAR_ACCESS_TOKEN: emptyStringAsUndefined(z.string().min(1).optional()),
  POLAR_WEBHOOK_SECRET: emptyStringAsUndefined(z.string().min(1).optional()),
  // Plan code to Polar product id: `pro_monthly=<id>,topup_250=<id>,...`. A
  // plan with no entry is not offered on Polar. The webhook maps an order's
  // product back to its plan through the same list.
  POLAR_PRODUCT_IDS: emptyStringAsUndefined(
    z
      .string()
      .regex(
        /^[a-z0-9_]+=[^\s,=]+(,[a-z0-9_]+=[^\s,=]+)*$/,
        'expected plan_code=product_id pairs separated by commas',
      )
      .optional(),
  ),
  // `sandbox` is SePay's Test mode (simulated transfers); `live` is the real
  // bank account. Shown to the client so a test-mode QR is labelled as one.
  SEPAY_MODE: emptyStringAsUndefined(
    z.enum(['sandbox', 'live']).default('sandbox'),
  ),
  // The webhook's HMAC-SHA256 secret, and the account and bank the VietQR names
  // (bank as SePay's short name, e.g. `MBBank`). Any missing: rail unavailable.
  SEPAY_WEBHOOK_SECRET: emptyStringAsUndefined(z.string().min(1).optional()),
  SEPAY_BANK_ACCOUNT: emptyStringAsUndefined(z.string().min(1).optional()),
  SEPAY_BANK: emptyStringAsUndefined(z.string().min(1).optional()),
  // The memo prefix every order code starts with. Must equal the prefix of the
  // payment-code structure configured in SePay (case-sensitive there), or the
  // webhook's `code` arrives null and matching falls back to the memo text.
  SEPAY_ORDER_PREFIX: emptyStringAsUndefined(
    z
      .string()
      .regex(/^[A-Z]{2,5}$/)
      .default('CHF'),
  ),
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
