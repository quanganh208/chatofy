'use client';

import type { Session } from 'next-auth';
import { signOutOfChatofy } from '@/lib/sign-out';

/** How a session read that may attempt a renewal is performed. */
export type SessionRefetch = () => Promise<Session | null | undefined>;

/**
 * What a 401 turned out to mean.
 *
 * `transient` is not "we do not know" — it is a positive answer: the session is
 * still live and the failure was something a retry can fix.
 */
export type RecoveryOutcome = 'refreshed' | 'signed-out' | 'transient';

/**
 * How long to wait for a replacement session before forcing a renewal.
 *
 * Generous on purpose. What it waits for is one server round trip — the password
 * change's response reaching this browser and writing its cookie — and every
 * genuine 401 recovery pays it, which is cheap only because those are rare: an
 * ageing token is renewed ahead of its expiry, so a 401 means a revocation.
 */
export const REPLACEMENT_SETTLE_MS = 1500;

/** A passive session read, and the wait between two of them. */
export interface ReplacementCheck {
  /** Reads the session WITHOUT forcing a renewal. */
  peek: SessionRefetch;
  settleMs?: number;
}

/**
 * Has this browser's cookie already been given a different, live token?
 *
 * THE OTHER TAB OF A PASSWORD CHANGE. Changing the password on `/account` revokes
 * every credential issued before it, and the API closes this user's sockets AT
 * ONCE — including ones held by other tabs of the very browser making the change,
 * whose replacement session has not reached the cookie yet. Those tabs see a dead
 * socket, probe, get a 401 and land here. Forcing a renewal at that moment renews
 * with the OLD cookie's refresh family, which the change revoked: the session is
 * marked terminal, and the sign-out that follows either revokes the replacement
 * family or overwrites the replacement cookie. The person who just changed their
 * password is signed out by their own success.
 *
 * So before forcing anything, look — passively — for a token that is already
 * different, now and again after the change has had time to land. A different
 * token without the terminal flag is exactly what a forced renewal would have
 * produced, minus the race. Nothing here signs anyone out; a session that is
 * still the old one falls through to the forced path, unchanged.
 */
async function replacedMeanwhile(
  { peek, settleMs = REPLACEMENT_SETTLE_MS }: ReplacementCheck,
  previousAccessToken: string | undefined,
): Promise<boolean> {
  const isReplacement = (session: Session | null | undefined) =>
    !!session?.accessToken && !session.error && session.accessToken !== previousAccessToken;

  if (isReplacement(await peek())) return true;
  await new Promise((resolve) => setTimeout(resolve, settleMs));
  return isReplacement(await peek());
}

/**
 * THE 401 path — one of them, for every transport.
 *
 * A 401 is ambiguous on its own: the access token may simply have aged out, or
 * the session may be over. This resolves it by asking for a session read on a
 * WRITABLE path, which is what gives the `jwt` callback a chance to rotate.
 *
 * IT COMPARES THE TOKEN RATHER THAN MERELY FINDING ONE, and that is the whole
 * correctness of it. Reporting `'refreshed'` whenever `session.accessToken` is
 * truthy reports success on every transient path — a 429, a 5xx, a timeout —
 * and the caller then retries with the identical expired token and 401s again,
 * forever. That is verbatim the symptom this whole change exists to remove: a
 * user fully "signed in" on an app where every request fails.
 *
 * `previousAccessToken` is the token that ACTUALLY produced the 401, passed in
 * by the caller rather than read here. Reading it here would mean calling the
 * session endpoint twice — and the first of those calls is itself a writable
 * path that would perform the rotation, so the "before" value would already be
 * the successor and every genuine refresh would read as `'transient'`.
 *
 * `refetch` is a parameter because the two transports genuinely need different
 * ones — see the call sites. Getting it wrong on the socket path costs up to
 * ten minutes of a dead meeting.
 */
export async function recoverFromUnauthorized(
  refetch: SessionRefetch,
  previousAccessToken: string | undefined,
  replacement?: ReplacementCheck,
): Promise<RecoveryOutcome> {
  if (replacement && (await replacedMeanwhile(replacement, previousAccessToken))) {
    return 'refreshed';
  }

  const session = await refetch();

  // `undefined` is NOT `null`, and the difference decides whether somebody is
  // signed out. `useSession().update` begins `if (loading) return;` — it
  // resolves `undefined` while the provider is still hydrating, while its own
  // type says `Promise<Session | null>`, so the compiler cannot catch this.
  // Reading that as "no session" signs out a perfectly live user for the crime
  // of asking early.
  if (session === undefined) return 'transient';

  // The one terminal signal. A pre-deploy cookie sets it in the callback too,
  // so there is no legacy branch to get wrong here.
  if (session?.error) {
    await signOutOfChatofy();
    return 'signed-out';
  }
  // NOT a sign-out, and this is the 401-only-is-terminal rule applied to our own
  // session endpoint. next-auth's `fetchData` returns `null` for ANY failure —
  // a network blip, a non-OK response, an unparseable body — so a null here
  // conflates "asked, and there is no session" with "could not ask at all".
  // Signing out on it lets a blip from the web app's own `/api/auth/session`
  // log the user out, which is exactly what this design forbids everywhere else.
  //
  // A genuinely signed-out user is not stranded by this: the route guard and the
  // signed-in layout both redirect on their next navigation, and `SessionGuard`
  // acts the moment the provider reports `error`. What this drops is only the
  // ability to sign somebody out from an ABSENCE of evidence.
  if (!session?.accessToken) return 'transient';

  return session.accessToken === previousAccessToken ? 'transient' : 'refreshed';
}
