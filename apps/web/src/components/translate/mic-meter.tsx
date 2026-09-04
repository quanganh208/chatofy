'use client';

import { useTranslate } from '@/i18n/provider';

interface MicMeterProps {
  /** The analyser's 0..1 RMS, straight from the hook. */
  level: number;
}

/**
 * How loud the microphone is hearing you, as seven bars.
 *
 * ## Height is data, never a keyframe
 *
 * The obvious version of "show me it is listening" is a blink on a timer. It is
 * wrong here for two reasons, and both are about the one question this control
 * exists to answer:
 *
 * 1. **A timed blink looks identical in a silent room and mid-sentence.** For the
 *    first few seconds of an utterance this is the ONLY feedback there is —
 *    nothing else on the screen moves until a translation lands — so a blink
 *    would confirm the page is alive while saying nothing about the microphone.
 * 2. **A keyframe is switched off by `prefers-reduced-motion`.** That reader
 *    would be left with no microphone feedback at all. A height driven by the
 *    signal survives: under reduced motion it stops easing and keeps reporting,
 *    which is the difference between still and dead.
 *
 * ## Neutral ink, not the accent
 *
 * The live hue is already on the status dot beside it, so this says loudness and
 * nothing else. It replaced a `bg-primary` filled track, which spent the screen's
 * loudest colour on a readout.
 *
 * The 3× gain is inherited from that track: speech RMS sits well below 1, and an
 * ungained meter barely leaves the floor at a conversational level.
 */
export function MicMeter({ level }: MicMeterProps) {
  const t = useTranslate();
  const value = Math.min(1, Math.max(0, level * 3));

  return (
    <div
      // `role="meter"` with a real value, where the cascade panel's track was
      // `role="presentation"` — the one control that answers "can it hear me?"
      // was absent from the accessibility tree on the product path, while the two
      // lab routes were already naming theirs with the key reused here.
      role="meter"
      aria-label={t('web.translate.micLevel')}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      className="flex h-[22px] flex-none items-center gap-1"
    >
      {BARS.map((factor, index) => (
        <span
          key={index}
          aria-hidden
          className="bg-muted-foreground w-[3px] rounded-full transition-[height] duration-75 motion-reduce:transition-none"
          // A floor of 4px, so a silent room reads as a meter at rest rather
          // than as a meter that is not there.
          style={{ height: `calc(4px + 18px * ${value} * ${factor})` }}
        />
      ))}
    </div>
  );
}

/** Tallest in the middle, so the shape reads as a level rather than as a bar chart. */
const BARS = [0.34, 0.62, 0.86, 1, 0.86, 0.62, 0.34] as const;
