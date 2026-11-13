'use client';

import { ThemeToggle, type ThemeChoice } from '@chatofy/ui/react';
import { useThemeChoice } from '@/hooks/use-preferences';
import { useTranslate } from '@/i18n/provider';

/**
 * The shared ThemeToggle, wired to this app's persistence.
 *
 * The component moved to `@chatofy/ui/react` so the extension popup can render
 * the same control, and it had to become controlled to get there: web reads
 * `localStorage` synchronously, the extension reads `chrome.storage` and gets an
 * answer a tick later, and no one component can hold both timings. It renders
 * what it is given; this file is where web's half lives.
 *
 * The `undefined` start is the part worth keeping. Server and client both render
 * with no selection marked, so the first paint agrees; the stored choice arrives
 * the render after hydration (`useThemeChoice`). The blocking script in
 * `app/layout.tsx` has already put the class on the document by then, so nothing
 * visibly changes — what would be visible is the alternative, a frame showing
 * `system` selected to someone who chose otherwise.
 *
 * The choice is an account preference: signed in, a pick here follows the reader
 * to their other devices; signed out, it is kept on this browser only.
 */
/** What a caller hears after a pick: the choice, the one it replaced, and a way back. */
export interface ThemeChange {
  next: ThemeChoice;
  previous: ThemeChoice;
  revert: () => void;
}

export function ConnectedThemeToggle({
  className,
  onChange,
}: {
  className?: string;
  /** Settings › General confirms the pick with a toast that can undo it. */
  onChange?: (change: ThemeChange) => void;
}) {
  const { choice, setChoice } = useThemeChoice();
  const t = useTranslate();

  return (
    <ThemeToggle
      className={className}
      value={choice}
      // The shared component defaults these to English so the extension popup,
      // which renders it and has no dictionary, needs no change at all. Web is
      // the surface that has one, so web is the surface that passes them down.
      labels={{
        light: t('common.theme.light'),
        dark: t('common.theme.dark'),
        system: t('common.theme.system'),
        group: t('common.theme.label'),
      }}
      onChange={(next) => {
        const previous: ThemeChoice = choice ?? 'system';
        setChoice(next);
        onChange?.({ next, previous, revert: () => setChoice(previous) });
      }}
    />
  );
}
