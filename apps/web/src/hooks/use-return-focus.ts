'use client';

import { useMemo, useRef } from 'react';

/**
 * Give focus back to whatever held it when a controlled dialog opened.
 *
 * Radix returns focus on close to the dialog's `Trigger`. A dialog opened from state
 * — the Settings dialog from the address, the password and photo dialogs from a
 * button's `onClick` — has no `Trigger`, so Radix focuses nothing and a keyboard
 * reader is dropped on `<body>`, out of the dialog underneath as well. These two
 * handlers remember the focused element as the dialog opens and focus it again as it
 * closes, if it is still on the page.
 *
 * Spread onto `DialogContent`: `<DialogContent {...useReturnFocus()}>`.
 */
export function useReturnFocus(): {
  onOpenAutoFocus: () => void;
  onCloseAutoFocus: (event: Event) => void;
} {
  const opener = useRef<HTMLElement | null>(null);
  return useMemo(
    () => ({
      onOpenAutoFocus: () => {
        opener.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
      },
      onCloseAutoFocus: (event: Event) => {
        const target = opener.current;
        opener.current = null;
        if (!target?.isConnected) return;
        event.preventDefault();
        target.focus();
      },
    }),
    [],
  );
}
