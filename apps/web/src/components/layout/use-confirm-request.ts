'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The request half of a destructive confirmation, shared by the dialog and the inline
 * strip so both fail the same way.
 *
 * A failure is kept as state so the caller can insert a `role="alert"` node (an
 * inserted alert is announced; rewritten text is not), and focus goes back to the
 * confirm button once it is re-enabled — a browser blurs a button that becomes
 * disabled, and a failure would otherwise leave the reader on `<body>`, pages away from
 * the retry the alert is talking about.
 */
export function useConfirmRequest(onConfirm: () => Promise<void>, onDone?: () => void) {
  const [deleting, setDeleting] = useState(false);
  const [failed, setFailed] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!failed || deleting) return;
    confirmRef.current?.focus();
  }, [failed, deleting]);

  const run = () => {
    setDeleting(true);
    setFailed(false);
    // Nothing on the happy path needs this component: the caller navigates away or
    // drops the row. `onDone` is for a caller that keeps it on screen.
    void onConfirm().then(
      () => {
        setDeleting(false);
        onDone?.();
      },
      () => {
        setDeleting(false);
        setFailed(true);
      },
    );
  };

  return { deleting, failed, setFailed, run, confirmRef };
}
