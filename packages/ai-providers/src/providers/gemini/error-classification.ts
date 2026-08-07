// What a Gemini failure condemns, and for how long.
//
// Every predicate here answers one question: how much of the (key × model)
// matrix does this failure rule out? Getting that wrong is what makes a pool
// behave worse than a single key — retiring a key over a per-model entitlement
// throws away its quota everywhere, and cooling only one pair on a server-wide
// overload pays a wasted round-trip per key to rediscover the same wall.
//
// The SDK surfaces these as an error whose message carries the raw JSON body,
// so both the structured fields and the message text are inspected.

/** Cooldown for a quota rejection whose body carries no `retryDelay`. */
const DEFAULT_COOLDOWN_MS = 60_000;

const DAY_MS = 86_400_000;

/**
 * How long an overloaded model is left alone. Short on purpose: the condition
 * is a transient capacity spike, and turns in a live conversation are seconds
 * apart — long enough that the next turn or two do not re-probe it, short
 * enough that a momentary spike cannot exile the fast model for the rest of
 * the conversation.
 */
export const OVERLOAD_COOLDOWN_MS = 10_000;

/**
 * Ceiling on a cooldown inferred from a daily quota, and on a model this key
 * may not use. Both are conditions the API does not put a clock on, so both
 * rest on a guess — and an hour keeps a wrong guess cheap while still sparing
 * the pool the great majority of the probes it would otherwise pay.
 */
export const MAX_DAILY_COOLDOWN_MS = 3_600_000;

/**
 * Wall clock in the timezone the daily quota resets on. Built once: an Intl
 * formatter is expensive to construct and this is read on the latency path.
 */
const PACIFIC_CLOCK = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles',
  hourCycle: 'h23',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/**
 * Time until the daily quota resets, which Google documents as midnight
 * Pacific.
 *
 * Off by an hour on the two days a year Pacific time shifts, since the day is
 * then 23 or 25 hours long. That is worth ignoring: the error costs one early
 * or one late probe, against the alternative this exists to remove — a
 * day-exhausted pair being re-probed every minute until midnight.
 */
function msUntilPacificMidnight(now: number): number {
  const parts = PACIFIC_CLOCK.formatToParts(new Date(now));
  const unit = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const elapsed = ((unit('hour') * 60 + unit('minute')) * 60 + unit('second')) * 1000;
  return DAY_MS - elapsed;
}

/** The error's message text, where the SDK puts the raw JSON body. */
function errorMessage(err: unknown): string {
  if (typeof err !== 'object' || err === null) return '';
  const { message } = err as { message?: unknown };
  return typeof message === 'string' ? message : '';
}

/** The status and code fields, whichever of them the SDK populated. */
function statusOf(err: unknown): { status?: unknown; code?: unknown } {
  if (typeof err !== 'object' || err === null) return {};
  return err as { status?: unknown; code?: unknown };
}

/**
 * How long a (key, model) pair that just rejected on quota should be left
 * alone, or null when the error is a transport or request fault rather than a
 * quota one.
 *
 * The free tier meters requests per minute AND per day, both per project per
 * model. The per-minute ceiling is the one a live conversation hits (measured:
 * 15/min on the flash-lite models, against 500/day), and it heals on its own —
 * the body says exactly when via `retryDelay`. Honouring that is what keeps a
 * burst of turns from pushing every later turn permanently down onto the slow
 * reserve.
 *
 * A DAILY rejection carries no `retryDelay`, and treating it as the one-minute
 * default would re-probe an exhausted pair every minute until midnight — a
 * round-trip that can only 429, paid on the latency path, once per pair. Its
 * `quotaId` names the period, so it is cooled until the reset instead.
 *
 * e.g. `{"error":{"code":429,…,"status":"RESOURCE_EXHAUSTED","quotaId":
 * "GenerateRequestsPerMinutePerProjectPerModel-FreeTier",…,"retryDelay":"52s"}}`
 */
export function quotaCooldownMs(err: unknown, now = Date.now()): number | null {
  const candidate = statusOf(err);
  const message = errorMessage(err);
  const isQuota =
    candidate.status === 429 ||
    candidate.code === 429 ||
    candidate.status === 'RESOURCE_EXHAUSTED' ||
    /RESOURCE_EXHAUSTED|"code"\s*:\s*429/.test(message);
  if (!isQuota) return null;

  const retrySeconds = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(message)?.[1];
  const isDaily = /"quotaId"\s*:\s*"[^"]*PerDay/i.test(message);
  const stated = retrySeconds ? Math.ceil(Number(retrySeconds) * 1000) : 0;

  if (!isDaily) return stated || DEFAULT_COOLDOWN_MS;

  // A daily bucket does not heal before its reset, so a stated delay shorter
  // than the wait is treated as a floor rather than the answer — otherwise a
  // small `retryDelay` quietly reinstates the every-minute re-probe this
  // branch exists to remove.
  //
  // Capped, though, and the cap is what makes the inference safe. Daily
  // counters do not reset atomically, so a request in the first moments after
  // midnight can still draw a daily rejection — and trusting the clock there
  // would park a bucket that just refilled for nearly a whole day. The cap
  // bounds that mistake to an hour while still cutting the probes from ~1440 a
  // day to ~24. It also makes the DST question moot.
  return Math.max(stated, Math.min(msUntilPacificMidnight(now), MAX_DAILY_COOLDOWN_MS));
}

/**
 * Whether the model itself is temporarily out of capacity, rather than this
 * project's quota being spent or the key being bad.
 *
 * Worth its own branch because it is the one remaining failure whose blast
 * radius is the MODEL: it is server-side and transient, so a different model
 * would very likely have served the turn. Treating it as unrecoverable — which
 * is what a single-key provider could afford to do — throws away a live turn
 * while healthy models sit unused.
 */
export function isOverloaded(err: unknown): boolean {
  const candidate = statusOf(err);
  const message = errorMessage(err);
  return (
    candidate.status === 503 ||
    candidate.code === 503 ||
    candidate.status === 'UNAVAILABLE' ||
    /UNAVAILABLE|overloaded|"code"\s*:\s*503/i.test(message)
  );
}

/**
 * Whether the API rejected the KEY itself — the credential is bad, whatever it
 * is asked for.
 *
 * Deliberately narrow. Only signals that are key-scoped belong here, because
 * the response is permanent retirement across every model. `PERMISSION_DENIED`
 * and a bare 403 are excluded: Gemini also returns those for conditions that
 * are per MODEL rather than per key — a model the project has not enabled, a
 * preview model it lacks access to — and retiring a whole key over one such
 * model would throw away its quota on all the others. Those are handled as a
 * pair-scoped denial instead; see {@link isModelDenied}.
 */
export function isAuthFailure(err: unknown): boolean {
  const candidate = statusOf(err);
  const message = errorMessage(err);
  return (
    candidate.status === 401 ||
    candidate.code === 401 ||
    candidate.status === 'UNAUTHENTICATED' ||
    /API_KEY_INVALID|UNAUTHENTICATED|"code"\s*:\s*401/.test(message)
  );
}

/**
 * Whether this key may not use this model — access, not credentials.
 *
 * Scoped to the pair: another project may well have the model enabled, and
 * this project's other models are unaffected. It does not heal on its own the
 * way a quota does, so it is cooled for a long time rather than retried, but
 * it is still cooled rather than made permanent — project entitlements do
 * change, and nothing here should require a restart to notice.
 */
export function isModelDenied(err: unknown): boolean {
  const candidate = statusOf(err);
  const message = errorMessage(err);
  return (
    candidate.status === 403 ||
    candidate.code === 403 ||
    candidate.status === 'PERMISSION_DENIED' ||
    /PERMISSION_DENIED|"code"\s*:\s*403/.test(message)
  );
}
