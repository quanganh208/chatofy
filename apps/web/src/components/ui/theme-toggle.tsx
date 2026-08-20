'use client';

import { useEffect, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';
import { applyChoice, readChoice, resolve, writeChoice, type ThemeChoice } from '@/lib/theme';

/**
 * Three states shown as three controls, not one button that cycles.
 *
 * A cycling button has to say what it will do next, which means the label changes
 * meaning on every press and "follow the machine" becomes a state you can only reach
 * by pressing twice more. Three radio-shaped controls say what is selected and let
 * any of them be chosen directly.
 */
const OPTIONS: ReadonlyArray<{ value: ThemeChoice; label: string; Icon: typeof Sun }> = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'Match system', Icon: Monitor },
];

export function ThemeToggle({ className }: { className?: string }) {
  // Starts as `system` on both server and client so the first render agrees. The
  // real choice arrives in the effect below; the blocking script in the document
  // head has already applied it to the page, so nothing visibly changes here.
  const [choice, setChoice] = useState<ThemeChoice>('system');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setChoice(readChoice());
    setReady(true);
  }, []);

  const select = (next: ThemeChoice) => {
    setChoice(next);
    writeChoice(next);
    applyChoice(next);
  };

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className={cn('border-border flex items-center gap-0.5 rounded-full border p-0.5', className)}
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        // Before the effect runs nothing is marked selected, rather than `system`
        // being marked when the reader may have chosen otherwise. One frame of no
        // selection beats a frame of the wrong one.
        const selected = ready && choice === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={label}
            title={label}
            onClick={() => select(value)}
            className={cn(
              'focus-visible:ring-ring rounded-full p-1.5 transition-colors',
              'focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none',
              selected
                ? 'bg-secondary text-foreground'
                : 'text-hint hover:text-foreground text-prose',
            )}
          >
            <Icon aria-hidden className="size-3.5" />
          </button>
        );
      })}
    </div>
  );
}

/**
 * What is on screen right now, for anything that needs to branch on it.
 *
 * Exported beside the control because the alternative is each caller re-deriving it
 * from storage and the media query, and getting the `system` case subtly different.
 */
export function useResolvedTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');

  useEffect(() => {
    const update = () => setTheme(resolve(readChoice()));
    update();
    const media = matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return theme;
}
