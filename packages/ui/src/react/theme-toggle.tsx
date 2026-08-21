import { Monitor, Moon, Sun } from 'lucide-react';
import { cn } from '../lib/utils.js';
import { ToggleGroup, ToggleGroupItem } from './toggle-group.js';

/**
 * Which ground the reader has asked for, as three controls rather than one that
 * cycles.
 *
 * A cycling button has to say what it will do next, so its label changes meaning
 * on every press and "follow the machine" becomes a state reachable only by
 * pressing twice more. Three radio-shaped controls say what is selected and let
 * any of them be chosen directly.
 *
 * **Built on `ToggleGroup`, which is where the radio shape now comes from.** It
 * used to be a hand-written `role="radiogroup"` of `role="radio"` buttons —
 * correct, but re-implementing what a primitive already provides. Radix's
 * single-mode ToggleGroup renders exactly those roles with `aria-checked`, and
 * brings roving focus with it.
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
 *
 * Two things about handing that `undefined` to Radix, neither of them obvious:
 *
 * - It is passed down as `''`, never as `undefined`. Radix reads `undefined` as
 *   "uncontrolled" and manages its own state; when the stored choice then arrives
 *   the component flips to controlled mid-life, which React warns about and which
 *   can strand the selection on whatever was clicked first.
 * - `onValueChange` fires with `''` when the selected item is pressed again —
 *   Radix deactivates it. A theme is always one of three, so the empty value is
 *   dropped rather than reported.
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
    <ToggleGroup
      type="single"
      value={value ?? ''}
      onValueChange={(next) => {
        if (next) onChange(next as ThemeChoice);
      }}
      aria-label="Colour theme"
      data-slot="theme-toggle"
      className={cn('border-hairline gap-0.5 rounded-full border p-0.5', className)}
    >
      {OPTIONS.map(({ value: option, label, Icon }) => (
        <ToggleGroupItem
          key={option}
          value={option}
          aria-label={label}
          title={label}
          // Sized against the icon rather than taking the primitive's default
          // 36px box: this sits inside the page header beside the brand, where a
          // full-height control would outweigh it.
          className="size-auto min-w-0 rounded-full p-1.5"
        >
          <Icon aria-hidden className="size-3.5" />
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
