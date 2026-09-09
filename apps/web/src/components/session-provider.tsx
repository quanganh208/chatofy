'use client';

import { SessionProvider } from 'next-auth/react';

/**
 * Makes the session readable from client components.
 *
 * A thin `'use client'` wrapper because the root layout is a server component
 * and Auth.js's provider is not. Nothing is passed in: the provider fetches
 * `/api/auth/session` itself, which keeps the token out of the server-rendered
 * HTML — where it would sit in the page source of every response.
 *
 * `refetchInterval` is tied to the access token's fifteen minutes: a tab left on
 * a long conversation renews before the token it would RECONNECT with goes
 * stale. That route handler is a writable path, so the poll is also where an
 * idle tab's renewal actually happens.
 *
 * IT ONLY HOLDS IF THE POLL FITS INSIDE THE SKEW. A renewal fires on the first
 * poll at or after `TTL - REFRESH_SKEW_SECONDS`, so a poll longer than the
 * window renews only after the token is already dead — at 900s/600s/60s the
 * polls landed at 600 and 1200 and an idle tab held a dead token for a fifth of
 * every cycle, which the socket path cannot retry its way out of. 300 against a
 * 360s skew renews at the 600s poll. Changing either number alone reopens the
 * gap; see `REFRESH_SKEW_SECONDS` in `@/lib/session-renewal`.
 *
 * The guard that ACTS on a dead session is deliberately not mounted here — this
 * provider sits in the root layout, and a guard beside it would run on the
 * routes the matcher exempts. See `app/(app)/layout.tsx`.
 */
export function AppSessionProvider({ children }: { children: React.ReactNode }) {
  return <SessionProvider refetchInterval={300}>{children}</SessionProvider>;
}
