import 'server-only';
import { apiSuccessSchema, planListResponseSchema, type Plan } from '@chatofy/types';
import { env } from '@/config/env';

/**
 * How long `/pricing` waits for the API before rendering without prices. The page is
 * server-rendered on every request, so this bounds the time to first byte when the
 * API hangs rather than refuses: a refusal fails fast on its own.
 */
export const PLANS_TIMEOUT_MS = 3_000;

/**
 * How long a fetched plan list is reused. Every render of `/pricing` and `/pricing.md`
 * reaches the API from this server's one address, so without this they all share one
 * per-IP throttle bucket and a crawler burst would render the page without prices. The
 * API caches the catalogue for the same minute, so nothing fresher is lost.
 */
export const PLANS_CACHE_MS = 60_000;

/**
 * How long a failure is remembered. `/` and `/pricing` render per request, so without
 * this a hung API costs every visitor the full {@link PLANS_TIMEOUT_MS}; remembered, an
 * outage costs one wait per window and recovery is noticed within it. Shorter than
 * {@link PLANS_CACHE_MS} because a failure is more likely to be transient than a price
 * is to change.
 */
export const PLANS_FAILURE_CACHE_MS = 15_000;

/** Built once: a schema factory called per request allocates a new object graph. */
const plansEnvelopeSchema = apiSuccessSchema(planListResponseSchema);

/**
 * The last answer, per API origin: the plans for {@link PLANS_CACHE_MS}, or `null` (a
 * failure) for {@link PLANS_FAILURE_CACHE_MS}.
 */
let cached: { apiBaseUrl: string; at: number; plans: Plan[] | null } | null = null;

/** Forgets the remembered plan list; for the spec. */
export function clearPublicPlansCache(): void {
  cached = null;
}

/**
 * The public plan list from `GET /billing/plans`, or `null` when it cannot be had.
 *
 * `null` covers every failure — unreachable, timed out, a non-2xx, a body that does not
 * parse — because the page has one answer to all of them: render without prices and
 * say so. A pricing page that 500s because the API is restarting tells a visitor less
 * than one that says the prices are unavailable right now.
 *
 * Never cached at build (`no-store`): prices are rows in the database, and a
 * prerendered copy would publish whatever the build machine saw. At run time a
 * successful answer is reused in memory for {@link PLANS_CACHE_MS}, and a failure for
 * {@link PLANS_FAILURE_CACHE_MS}.
 *
 * The parameters exist for the spec; the page calls it with none.
 */
export async function fetchPublicPlans(
  fetchImpl: typeof fetch = fetch,
  apiBaseUrl: string = env.NEXT_PUBLIC_API_BASE_URL,
  timeoutMs: number = PLANS_TIMEOUT_MS,
): Promise<Plan[] | null> {
  const now = Date.now();
  if (cached && cached.apiBaseUrl === apiBaseUrl) {
    const ttl = cached.plans ? PLANS_CACHE_MS : PLANS_FAILURE_CACHE_MS;
    if (now - cached.at < ttl) return cached.plans;
  }
  const plans = await requestPublicPlans(fetchImpl, apiBaseUrl, timeoutMs);
  cached = { apiBaseUrl, at: now, plans };
  return plans;
}

/** One request to the API: the plans, or `null` on any failure. Never throws. */
async function requestPublicPlans(
  fetchImpl: typeof fetch,
  apiBaseUrl: string,
  timeoutMs: number,
): Promise<Plan[] | null> {
  try {
    const response = await fetchImpl(new URL('/billing/plans', apiBaseUrl), {
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      console.warn(`[pricing] GET /billing/plans answered ${response.status}`);
      return null;
    }
    const parsed = plansEnvelopeSchema.safeParse(await response.json());
    if (!parsed.success) {
      console.warn('[pricing] GET /billing/plans returned a body that is not a plan list');
      return null;
    }
    return parsed.data.data.plans;
  } catch (error) {
    // Network failure, the timeout's AbortError, or a body that is not JSON.
    console.warn('[pricing] GET /billing/plans failed:', (error as Error).message);
    return null;
  }
}
