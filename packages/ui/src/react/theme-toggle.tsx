import { Monitor, Moon, Sun } from 'lucide-react';
import { cn } from '../lib/utils.js';

/**
 * Which ground the reader has asked for, as three controls rather than one that
 * cycles.
 *
 * A cycling button has to say what it will do next, so its label changes meaning
 * on every press and "follow the machine" becomes a state reachable only by
 * pressing twice more. Three radio-shaped controls say what is selected and let
 * any of them be chosen directly.
 *
 * **Controlled, and that is a change.** The web version read `localStorage`
 * synchronously inside a mount effect, deliberately, so the server's first render
 * and the client's agreed; the extension reads `chrome.storage` and only gets an
 * answer a tick later. No single component can own both, so this one owns
 * neither: it renders what it is given and reports what was clicked. Each surface
 * keeps its own persistence module — `apps/web/src/lib/theme.ts` and
 * `apps/extension/src/theme.ts` — and each keeps the timing that suits it.
 *
 * `value` may be `undefined`, and that is the hydration-safe state the web app
 * depends on: nothing marked selected until the stored choice is known. One frame
 * showing no selection beats one frame showing the wrong one.
 */

export type ThemeChoice = 'light' | 'dark' | 'system';

const OPTIONS: ReadonlyArray<{ value: ThemeChoice; label: string; Icon: typeof Sun }> = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'Match system', Icon: Monitor },
];

interface ThemeToggleProps {
  /** The stored choice, or `undefined` while it is still unknown. */
  value: ThemeChoice | undefined;
  onChange: (choice: ThemeChoice) => void;
  className?: string;
}

export function ThemeToggle({ value, onChange, className }: ThemeToggleProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      data-slot="theme-toggle"
      className={cn('border-border flex items-center gap-0.5 rounded-full border p-0.5', className)}
    >
      {OPTIONS.map(({ value: option, label, Icon }) => {
        const selected = value === option;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={label}
            title={label}
            onClick={() => onChange(option)}
            className={cn(
              'focus-visible:ring-ring rounded-full p-1.5 transition-colors',
              'focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none',
              selected
                ? 'bg-secondary text-foreground'
                : 'text-hint text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon aria-hidden className="size-3.5" />
          </button>
        );
      })}
    </div>
  );
}
