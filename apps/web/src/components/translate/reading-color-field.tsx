'use client';

import { useState } from 'react';
import { Ban, Palette } from 'lucide-react';
import type { ColorScheme } from '@chatofy/ui';
import { Input } from '@chatofy/ui/react';
import { isHexColor } from '@/lib/color-contrast';
import { READABLE_CONTRAST, type HexColor, type InkContrast } from '@/lib/reading-appearance';
import { useTranslate } from '@/i18n/provider';
import { cn } from '@/lib/utils';

type Pair = { readonly light: string; readonly dark: string };

/**
 * One colour slot: a row of swatches, a custom colour, and — for an ink — how
 * readable the choice is on the ground it will be drawn on.
 *
 * ## Swatches are toggles, not an accent
 *
 * Each is a `button` with `aria-pressed`, named by the colour's word ("Amber"),
 * never by its hex: a screen reader saying "number eight A four B zero zero" is
 * not telling anybody what they picked. The pressed swatch shows a ring, never a
 * fill — the screen's one accent-filled control is Start (`accent-count.ts`).
 * Each swatch paints its pair with `light-dark()`, so it shows the colour the
 * reader will actually get in the theme on screen.
 *
 * ## The warning advises, it never refuses
 *
 * A custom colour is the reader's, and some readers need a pairing this product
 * would not choose — low vision that wants yellow on navy, a projector that
 * washes everything out. So nothing here blocks a value. What it does is say, in
 * words, when a choice falls under the 4.5:1 floor the presets are held to, and
 * when it holds in this theme and not the other one: a custom hex applies in
 * both, and a colour that vanishes after a theme switch is the surprise to
 * prevent.
 */
export function ReadingColorField<P extends string>({
  label,
  value,
  presets,
  presetLabel,
  contrast,
  scheme,
  onChange,
}: {
  label: string;
  value: 'default' | P | HexColor;
  presets: Readonly<Record<P, Pair>>;
  presetLabel: (preset: P) => string;
  /** How readable this ink is. Absent for a ground, which is measured by its inks. */
  contrast?: InkContrast;
  scheme: ColorScheme;
  onChange: (value: 'default' | P | HexColor) => void;
}) {
  const t = useTranslate();
  const custom = isHexColor(value);
  const [customOpen, setCustomOpen] = useState(custom);
  const [draft, setDraft] = useState(custom ? value : '');
  // Follow a value changed from OUTSIDE — Reset, or the stored settings loading —
  // during render, the documented way to adjust state to a prop. Without it a
  // reset left "Custom" pressed beside a pressed "Default".
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    if (isHexColor(value)) setDraft(value);
    else setCustomOpen(false);
  }
  const pickerValue = isHexColor(draft) ? draft : custom ? value : '#808080';

  const commit = (next: string) => {
    setDraft(next);
    if (isHexColor(next)) onChange(next.toLowerCase() as HexColor);
  };

  const ratio = contrast ? contrast.ratio.toFixed(1) : null;
  const low = contrast !== undefined && contrast.ratio < READABLE_CONTRAST;

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-body mb-2 font-medium">{label}</legend>
      <div className="flex flex-wrap items-center gap-1.5">
        <Swatch
          label={t('web.translate.colorDefault')}
          pressed={value === 'default'}
          onClick={() => {
            setCustomOpen(false);
            onChange('default');
          }}
        >
          <Ban aria-hidden className="text-muted-foreground size-3.5" />
        </Swatch>
        {(Object.keys(presets) as P[]).map((preset) => (
          <Swatch
            key={preset}
            label={presetLabel(preset)}
            pressed={value === preset}
            color={presets[preset]}
            onClick={() => {
              setCustomOpen(false);
              onChange(preset);
            }}
          />
        ))}
        <Swatch
          label={t('web.translate.colorCustom')}
          pressed={custom || customOpen}
          color={custom ? { light: value, dark: value } : undefined}
          onClick={() => {
            setCustomOpen(true);
            // The last custom colour, again — not an editor showing a hex that is
            // not applied.
            if (isHexColor(draft)) onChange(draft.toLowerCase() as HexColor);
          }}
        >
          {custom ? null : <Palette aria-hidden className="text-muted-foreground size-3.5" />}
        </Swatch>
      </div>

      {custom || customOpen ? (
        <div className="flex items-center gap-2">
          {/* The native picker for choosing by eye, the field for a code someone
              already has. Both write the same value. */}
          <input
            type="color"
            aria-label={label}
            value={pickerValue}
            onChange={(event) => commit(event.target.value)}
            className="border-hairline size-9 shrink-0 cursor-pointer rounded-md border bg-transparent p-0.5"
          />
          <Input
            aria-label={t('web.translate.colorHex')}
            placeholder="#RRGGBB"
            value={draft}
            maxLength={7}
            spellCheck={false}
            aria-invalid={draft !== '' && !isHexColor(draft)}
            onChange={(event) => commit(event.target.value.trim())}
            className="w-28 font-mono"
          />
        </div>
      ) : null}

      {ratio === null ? null : (
        <p
          // Announced only when it turns into a warning; the plain ratio is a
          // readout that changes with every swatch and would be noise.
          role={low || contrast?.failsInOtherScheme ? 'status' : undefined}
          className={cn('text-hint', low ? 'text-warning' : 'text-muted-foreground')}
        >
          {low
            ? t('web.translate.contrastLow', { ratio })
            : t('web.translate.contrastRatio', { ratio })}
          {!low && contrast?.failsInOtherScheme ? (
            <>
              {' · '}
              <span className="text-warning">
                {t(
                  scheme === 'light'
                    ? 'web.translate.contrastOtherDark'
                    : 'web.translate.contrastOtherLight',
                )}
              </span>
            </>
          ) : null}
        </p>
      )}
    </fieldset>
  );
}

function Swatch({
  label,
  pressed,
  color,
  onClick,
  children,
}: {
  label: string;
  pressed: boolean;
  color?: Pair;
  onClick: () => void;
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
      style={
        color
          ? {
              backgroundColor:
                color.light === color.dark
                  ? color.light
                  : `light-dark(${color.light}, ${color.dark})`,
            }
          : undefined
      }
      className={cn(
        'border-border-control focus-visible:ring-ring flex size-7 items-center justify-center rounded-full border focus-visible:ring-2 focus-visible:outline-none',
        // A ring with a gap, so the pressed state reads on every swatch colour —
        // a border alone disappears into a swatch of the same darkness.
        pressed && 'ring-foreground ring-offset-background ring-2 ring-offset-2',
      )}
    >
      {children}
    </button>
  );
}
