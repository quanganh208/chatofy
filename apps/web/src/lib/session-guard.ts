import type { Session } from 'next-auth';

/**
 * Is this session still usable, or only still present?
 *
 * ONE predicate, read at every session-gating site: the route guard, the
 * signed-in layout, both reverse guards on `/login` and `/register`, and the
 * two marketing components. They already disagreed in SHAPE — one tested
 * `req.auth` truthiness, one compared against `null`, one sat inside a
 * `Promise.all` — which is the argument for a shared predicate rather than five
 * inline `session?.error` checks: sites that cannot disagree cannot drift.
 *
 * APPLYING IT TO FEWER THAN ALL OF THEM SHIPS AN INFINITE REDIRECT, and that is
 * the default outcome of the obvious implementation rather than an edge case:
 * an errored-but-cookied session redirected to `/login` meets the reverse guard
 * there, which redirects to `/translate`, which the route matcher gates, which
 * redirects back to `/login`.
 *
 * IT MUST NOT CONSULT `expiresAt`. A Server Component legitimately reads a
 * session whose access token has expired but is still refreshable — RSC renders
 * cannot write a cookie, so they never rotate — and testing expiry here would
 * render a live user signed out on every such page. Liveness is "has the
 * renewal path given up", which is exactly what `error` records.
 */
export function isLiveSession(session: Session | null | undefined): boolean {
  return session != null && session.error === undefined;
}
