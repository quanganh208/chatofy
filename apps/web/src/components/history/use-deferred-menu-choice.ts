'use client';

import { useRef } from 'react';

/** The menu items that open a dialog, and so act only once the menu has closed. */
export type DeferredChoice = 'rename' | 'delete';

/**
 * A menu item that opens a dialog records its choice; the menu's own close then
 * reports it and skips its return-to-trigger.
 *
 * Opening the dialog from the item itself raced the menu's focus trap: the dialog
 * took focus while the menu was still mounted, the trap pulled it back, and the
 * menu's unmount dropped focus on `<body>` — under a modal that then had nothing
 * focused. Spread `onCloseAutoFocus` on the menu content and call `choose` from
 * the item's `onSelect`.
 */
export function useDeferredMenuChoice(onChoose: (choice: DeferredChoice) => void) {
  const deferred = useRef<DeferredChoice | null>(null);
  return {
    choose: (choice: DeferredChoice) => {
      deferred.current = choice;
    },
    onCloseAutoFocus: (event: Event) => {
      const choice = deferred.current;
      if (!choice) return;
      deferred.current = null;
      event.preventDefault();
      onChoose(choice);
    },
  };
}
