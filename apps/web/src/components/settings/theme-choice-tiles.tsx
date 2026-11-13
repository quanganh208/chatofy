'use client';

import { useId } from 'react';
import { RadioGroup, RadioGroupItem } from '@chatofy/ui/react';
import type { ThemeChange } from '@/components/layout/theme-toggle-connected';
import { useThemeChoice } from '@/hooks/use-preferences';
import { useTranslate } from '@/i18n/provider';
import type { ThemeChoice } from '@/lib/theme';
import { cn } from '@/lib/utils';

const CHOICES = ['light', 'dark', 'system'] as const satisfies readonly ThemeChoice[];

/**
 * The colour theme as three pictures of the app — Light, Dark, Match system — with
 * the pick marked by a ring around its picture.
 *
 * A radio group, because that is what it is: one of three, arrows move the choice.
 * Radix's radio checks on arrow focus, so the announcement and the behaviour agree.
 * The small radio under each picture is the shadcn `RadioGroupItem`; the whole tile
 * is its `<label>`, so a press anywhere on it picks.
 *
 * The choice is the account's, read as in `ConnectedThemeToggle`: server and first
 * client render mark nothing, and the stored choice arrives the render after.
 *
 * The ring is ink at rest-weight, not an accent FILL: a selected state is a readout,
 * and the screen's one filled control belongs elsewhere.
 */
export function ThemeChoiceTiles({ onChange }: { onChange?: (change: ThemeChange) => void }) {
  const t = useTranslate();
  const id = useId();
  const { choice, setChoice } = useThemeChoice();

  return (
    <RadioGroup
      // Controlled with `''` until storage is read, so nothing is marked rather than
      // the wrong tile for one frame.
      value={choice ?? ''}
      aria-label={t('common.theme.label')}
      onValueChange={(value) => {
        const next = value as ThemeChoice;
        const previous: ThemeChoice = choice ?? 'system';
        if (next === previous) return;
        setChoice(next);
        onChange?.({ next, previous, revert: () => setChoice(previous) });
      }}
      className="grid w-full grid-cols-3 gap-3 sm:gap-4"
    >
      {CHOICES.map((value) => {
        const itemId = `${id}-${value}`;
        return (
          <label
            key={value}
            htmlFor={itemId}
            data-theme-tile={value}
            className="group/tile flex min-w-0 cursor-pointer flex-col gap-2"
          >
            <span
              aria-hidden
              className={cn(
                'border-border relative block aspect-[4/3] overflow-hidden rounded-md border',
                'duration-fast ease-standard transition-[border-color,box-shadow] motion-reduce:transition-none',
                'group-hover/tile:border-border-strong',
                // The pick: an ink ring outside the hairline, two pixels in all.
                'group-has-[[data-state=checked]]/tile:border-primary group-has-[[data-state=checked]]/tile:ring-primary group-has-[[data-state=checked]]/tile:ring-1',
              )}
            >
              {value === 'system' ? (
                <>
                  <AppPreview scheme="light" />
                  {/* The right half in dark: the machine decides which one shows. */}
                  <span className="absolute inset-0 [clip-path:inset(0_0_0_50%)]">
                    <AppPreview scheme="dark" />
                  </span>
                </>
              ) : (
                <AppPreview scheme={value} />
              )}
            </span>
            {/* Below `sm` three tiles leave a label about 70px beside its radio, so
                "Match system" wrapped and Light and Dark did not, and the three read as
                three layouts. There the radio sits centred under its picture and the label
                centred under the radio, as a phone's own appearance picker does: the
                radios stay in one row, and a label that wraps balances under its tile.
                From `sm` the radio returns beside the label. */}
            <span className="flex min-w-0 flex-col items-center gap-1.5 text-center sm:flex-row sm:items-start sm:gap-2 sm:text-left">
              <RadioGroupItem id={itemId} value={value} aria-labelledby={`${itemId}-label`} />
              <span
                id={`${itemId}-label`}
                className="text-body min-w-0 leading-tight font-medium text-balance"
              >
                {t(`common.theme.${value}`)}
              </span>
            </span>
          </label>
        );
      })}
    </RadioGroup>
  );
}

/**
 * A thumbnail of the app in one scheme: the sidebar, a sheet with two lines of text,
 * and the one ink action. Decorative.
 *
 * Drawn inside a `reading-scheme-*` island and from the RAW tokens (`--card`,
 * `--border`, …): the tokens are `light-dark()` pairs re-declared on that class, so
 * here they resolve in the island's scheme whatever the page is in. The `--color-*`
 * aliases behind `bg-card` and friends arrive already resolved from `:root`, so a
 * utility would paint the page's scheme instead.
 */
function AppPreview({ scheme }: { scheme: 'light' | 'dark' }) {
  return (
    <span
      className={cn(`reading-scheme-${scheme}`, 'absolute inset-0 flex bg-[var(--background)]')}
    >
      <span className="flex w-1/4 flex-col gap-1 border-r border-[var(--border)] bg-[var(--card)] p-1.5">
        <span className="h-1 w-3/4 rounded-full bg-[var(--muted-foreground)] opacity-70" />
        <span className="h-1 w-1/2 rounded-full bg-[var(--muted-foreground)] opacity-40" />
        <span className="h-1 w-2/3 rounded-full bg-[var(--muted-foreground)] opacity-40" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1.5 p-2">
        <span className="flex flex-col gap-1 rounded-sm border border-[var(--border)] bg-[var(--card)] p-1.5">
          <span className="h-1 w-full rounded-full bg-[var(--foreground)] opacity-80" />
          <span className="h-1 w-2/3 rounded-full bg-[var(--muted-foreground)] opacity-60" />
        </span>
        <span className="h-1 w-1/2 rounded-full bg-[var(--muted-foreground)] opacity-40" />
        <span className="mt-auto h-2 w-1/3 self-end rounded-full bg-[var(--primary)]" />
      </span>
    </span>
  );
}
