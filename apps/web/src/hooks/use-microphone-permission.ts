'use client';

import { useEffect, useState } from 'react';

/**
 * What the browser will say if the microphone is asked for — without asking.
 *
 * Four answers, and the two that are not `granted`/`denied` carry real information
 * that must not be collapsed into each other:
 *
 * - `prompt` — the browser knows nothing has been decided. Starting a conversation
 *   will show the permission sheet. That is a fact, not an absence of one.
 * - `unknown` — the query could not be made. The Permissions API does not answer for
 *   `microphone` in every browser (Safari has historically not), and `query` throws
 *   rather than resolving where the name is unsupported.
 *
 * **Nothing here may default to `granted`.** Claiming a permission that was never
 * checked is worse than admitting it cannot be told: the user finds out at the moment
 * they start talking. `readiness-banner.tsx` treats `unknown` as "say nothing" for
 * the same reason — it is the absence of an answer, not an answer.
 *
 * The `change` subscription matters as much as the query. Permission is revoked from
 * browser chrome this page cannot see, so a one-shot read goes stale silently — a
 * blocked microphone would go unreported until the moment someone pressed Start.
 *
 * No state is set synchronously in the effect: the initial value is the honest one
 * already, and writing it again on mount would be a render for nothing.
 */
export type MicrophonePermission = 'granted' | 'denied' | 'prompt' | 'unknown';

export function useMicrophonePermission(): MicrophonePermission {
  const [permission, setPermission] = useState<MicrophonePermission>('unknown');

  useEffect(() => {
    let cancelled = false;
    let status: PermissionStatus | undefined;
    const onChange = () => {
      if (!cancelled && status) setPermission(status.state);
    };

    // Optional-chained: `navigator.permissions` is itself absent in some browsers,
    // and reading `.query` off `undefined` would throw where the whole point is to
    // degrade to `unknown`.
    navigator.permissions
      ?.query({ name: 'microphone' })
      .then((result) => {
        if (cancelled) return;
        status = result;
        setPermission(result.state);
        result.addEventListener('change', onChange);
      })
      .catch(() => {
        // Unsupported name, or a browser that refuses the query. `unknown` is
        // already what the state holds, so there is nothing to write.
      });

    return () => {
      cancelled = true;
      status?.removeEventListener('change', onChange);
    };
  }, []);

  return permission;
}
