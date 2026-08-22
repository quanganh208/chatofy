'use client';

import { useEffect, useState } from 'react';
import { ThemeToggle, type ThemeChoice } from '@chatofy/ui/react';
import { applyChoice, readChoice, writeChoice } from '@/lib/theme';

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
 * in the effect below. The blocking script in `app/layout.tsx` has already put
 * the class on the document by then, so nothing visibly changes — what would be
 * visible is the alternative, a frame showing `system` selected to someone who
 * chose otherwise.
 */
export function ConnectedThemeToggle({ className }: { className?: string }) {
  const [choice, setChoice] = useState<ThemeChoice | undefined>(undefined);

  useEffect(() => {
    setChoice(readChoice());
  }, []);

  return (
    <ThemeToggle
      className={className}
      value={choice}
      onChange={(next) => {
        setChoice(next);
        writeChoice(next);
        applyChoice(next);
      }}
    />
  );
}
