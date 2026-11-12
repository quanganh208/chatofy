'use client';

import { useEffect, useRef } from 'react';
import { notify } from '@/lib/notify';

/**
 * A failure this screen's state already holds, said once as a toast.
 *
 * The translator's outcomes — a start that failed, a save or an upload that was
 * refused, a caption window the browser blocked — used to be `Alert`s stacked
 * between the panes and the dock, where each one moved the dock down mid-screen.
 * They are results of something that just happened, so they are toasts now; what
 * explains a standing STATE (the readiness banner, the credits notice) stays on
 * the page.
 *
 * Keyed on the message alone. The toast is raised when `message` turns non-null or
 * changes, and taken down when it clears — so a hook whose failure clears on retry
 * and comes back raises it again, and a re-render that hands a new `retry` closure
 * does not resurrect a toast the reader already dismissed. `retry` is read through
 * a ref for that reason: the toast's button calls whatever the latest one is.
 *
 * Errors persist until dismissed (`notify.error`), and the stable `id` means a
 * second failure replaces the first instead of stacking beside it.
 */
export function useErrorToast(id: string, message: string | null, retry?: () => void): void {
  const retryRef = useRef(retry);
  const hasRetry = retry !== undefined;
  useEffect(() => {
    retryRef.current = retry;
  });

  const shown = useRef(false);
  useEffect(() => {
    if (message === null) {
      if (shown.current) notify.dismiss(id);
      shown.current = false;
      return;
    }
    shown.current = true;
    notify.error(message, {
      id,
      ...(hasRetry ? { retry: () => retryRef.current?.() } : {}),
    });
  }, [id, message, hasRetry]);
}
