import 'server-only';
import { apiSuccessSchema, planListResponseSchema, type Plan } from '@chatofy/types';
import { env } from '@/config/env';

/**
 * How long `/pricing` waits for the API before rendering without prices. The page is
 * server-rendered on every request, so this bounds the time to first byte when the
 * API hangs rather than refuses: a refusal fails fast on its own.
 */
export const PLANS_TIMEOUT_MS = 3_000;

/** Built once: a schema factory called per request allocates a new object graph. */
const plansEnvelopeSchema = apiSuccessSchema(planListResponseSchema);

/**
 * The public plan list from `GET /billing/plans`, or `null` when it cannot be had.
 *
 * `null` covers every failure — unreachable, timed out, a non-2xx, a body that does not
 * parse — because the page has one answer to all of them: render without prices and
 * say so. A pricing page that 500s because the API is restarting tells a visitor less
 * than one that says the prices are unavailable right now.
 *
 * Fetched per request (`no-store`), never cached at build: prices are rows in the
 * database, and a prerendered copy would publish whatever the build machine saw.
 *
 * The parameters exist for the spec; the page calls it with none.
 */
export async function fetchPublicPlans(
  fetchImpl: typeof fetch = fetch,
  apiBaseUrl: string = env.NEXT_PUBLIC_API_BASE_URL,
  timeoutMs: number = PLANS_TIMEOUT_MS,
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
