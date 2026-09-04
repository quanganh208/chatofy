'use client';

import { Slider } from '@chatofy/ui/react';
import { cn } from '@/lib/utils';
import { TEXT_SIZE_SCALES } from '@/lib/translate-settings';

/**
 * The reading size, shown as a size rather than as a number.
 *
 * ## The numbers were decoration, and they did not line up
 *
 * This printed 1 through 10 under the track, `aria-hidden` because the slider
 * already announces its value — so they were ten pieces of text no screen reader
 * ever read, added in the same hour the panel's five explanatory sentences were
 * deleted for being text nobody needed.
 *
 * They were also misaligned. Radix writes `left: calc(p% + offset)` on the thumb
 * with an offset linear in the thumb's width, plus a `-50%` transform, which
 * reduces to a centre at `8 + p·(W - 16)` for a `size-4` thumb. A row of ten
 * spans under `justify-between` with no inset centres its i-th span at
 * `p·(W - w) + w/2` for span width `w`. The two agree exactly at the midpoint and
 * diverge toward the ends, by half the thumb — 8px — at 1 and at 10. So the
 * numbers were furthest from their stops at precisely the two values a reader
 * aims for.
 *
 * ## What replaced them
 *
 * Two letters and ten notches.
 *
 * The letters ARE the scale: `text-hint` on the left and `text-translation` on
 * the right are the two role tokens this control multiplies, so the anchors
 * demonstrate the range instead of numbering it. A reader who wants bigger text
 * moves toward the bigger letter, which needs no legend.
 *
 * The notches are inset by half the thumb MINUS half a notch: 8px - 2px = 6px,
 * which is `inset-x-1.5` against a `size-4` thumb and `size-1` notches. That is
 * the inset at which `justify-between` puts notch centres at `8 + p·(W - 16)` —
 * the thumb's own centre, at every stop rather than only at the middle. Half the
 * thumb alone would still be 2px out at each end, which is the same mistake the
 * numbers made, smaller.
 *
 * The two constants are tied to two utility classes here and in `slider.tsx`. If
 * either the thumb or the notch changes size this inset is wrong again, and it is
 * wrong in the quiet way — a few pixels, at the ends only.
 *
 * They are `bg-card`, and that is the thumb's own fill. The choice is already
 * measured: `packages/ui/src/react/slider.tsx` records it clearing 1.4.11 against
 * both track states in both schemes — 3.34 and 3.36:1 on an empty track, 6.50 and
 * 5.86:1 on a filled one. A notch has to stay visible on both halves of the track
 * for the same reason the thumb does, so it takes the fill that was proven for it
 * rather than a second one nobody checked.
 *
 * ## Drawn AFTER the slider, which is the opposite of what reasoning gave
 *
 * The first version put the overlay first, arguing that two positioned siblings
 * paint in document order so an overlay written last would sit over the thumb.
 * True, and it missed that the TRACK is in that order too: `bg-muted` is opaque,
 * so it covered every notch and the control shipped as a plain bar. Measured
 * afterwards by screenshotting both orders in headless Chrome and reading the
 * pixel at each notch centre — first order returns the track's colour at all ten,
 * second returns the notch's.
 *
 * Over the thumb the notch is invisible anyway: both are `bg-card`, so the mark
 * at the current step is absorbed into the handle sitting on it. `pointer-events-
 * none` is what keeps the drag, the hover and the keyboard working underneath.
 *
 * ## No preview line
 *
 * The transcript behind this popover is the preview. It re-typesets as the thumb
 * moves, at the size actually being chosen, in the reader's own conversation — a
 * specimen inside the popover would be a worse copy of something already on
 * screen, and it would need words to explain what it was.
 */
export function TextSizeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (textSize: number) => void;
}) {
  const steps = TEXT_SIZE_SCALES.length;

  return (
    <div className="flex min-w-52 flex-1 items-center gap-3">
      {/* Both anchors are `aria-hidden`: they say "smaller" and "larger" to the
          eye, and a screen reader hearing "A … A" around a slider learns nothing
          the slider's own name and value do not already give it. */}
      <span aria-hidden className="text-muted-foreground text-hint leading-none">
        A
      </span>

      <div className="relative flex flex-1 items-center">
        <Slider
          stepped
          aria-label={label}
          className="flex-1"
          value={[value]}
          min={1}
          max={steps}
          step={1}
          onValueChange={([next]) =>
            // Radix types the payload as a possibly-empty array; a single-thumb
            // slider always reports one value, and falling back to the current one
            // is more honest than asserting that.
            onChange(next ?? value)
          }
        />

        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-1.5 flex items-center justify-between"
        >
          {Array.from({ length: steps }, (_, index) => (
            <span
              key={index}
              className={cn(
                'size-1 rounded-full bg-card',
                'transition-transform duration-fast ease-standard motion-reduce:transition-none',
                // Size only, never opacity. These sit on the filled half of the
                // track as well as the empty one, and a composited opacity is the
                // one thing `design/contrast-floors.spec.ts` cannot see — it reads
                // raw tokens, which is how a dimmed row on `/history` once shipped
                // at 4.07:1. `bg-card` against both track states is already
                // measured in `packages/ui/src/react/slider.tsx`; scaling keeps
                // that measurement true.
                index + 1 <= value ? 'scale-100' : 'scale-75',
              )}
            />
          ))}
        </div>
      </div>

      <span aria-hidden className="text-translation leading-none">
        A
      </span>
    </div>
  );
}
