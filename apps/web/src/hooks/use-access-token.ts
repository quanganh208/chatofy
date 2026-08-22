'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useSession } from 'next-auth/react';

/**
 * Reads the current access token at the moment it is needed.
 *
 * A getter rather than a value, and that is the whole point. `useSession()`
 * returns `{ data: undefined, status: 'loading' }` on the first client render
 * while the provider fetches `/api/auth/session`. Consumers here build their
 * transport ONCE — `sessionRef.current ??= …`, or a `useCallback` whose deps
 * cannot include the token without tearing down a live conversation — so a
 * plain value would be captured empty on that first render and never updated.
 * Every socket would then dial with no credential and be refused at the
 * upgrade, for a user who is perfectly well signed in.
 *
 * The returned object is stable, so capturing it in a closure is safe; the ref
 * behind it is refreshed every render, so calling it gives the live answer.
 * This mirrors what the extension already does — it reads the token per capture
 * rather than holding one.
 */
export interface AccessTokenReader {
  /** The token as of this call. Empty while loading or signed out. */
  current: () => string;
  /**
   * The session has not resolved yet. Emphatically NOT the same as signed out:
   * treating the two alike signs a valid session out over a slow first paint.
   */
  isLoading: () => boolean;
}

export function useAccessToken(): AccessTokenReader {
  const { data, status } = useSession();
  const accessToken = data?.accessToken ?? '';
  const loading = status === 'loading';

  const latest = useRef({ token: '', loading: true });

  // Written in an effect, never during render. A ref assigned mid-render is
  // read by `react-hooks/refs` as a bug for good reason: with StrictMode on —
  // and it is, in next.config.ts — the render runs twice, and under concurrent
  // rendering a render can be discarded entirely, so a value written there
  // belongs to a pass that may never have committed.
  //
  // Running after commit is not a problem for the readers: the transports call
  // `current()` when a user starts a conversation, which is many frames after
  // the session resolved.
  useEffect(() => {
    latest.current = { token: accessToken, loading };
  }, [accessToken, loading]);

  return useMemo(
    () => ({
      current: () => latest.current.token,
      isLoading: () => latest.current.loading,
    }),
    [],
  );
}
