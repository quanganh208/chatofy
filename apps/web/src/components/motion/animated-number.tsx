'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * A number that counts to its new value instead of jumping, when it changes.
 *
 * The first render shows the value as it is, with no count from zero: a balance that
 * climbs from 0 on every visit would say, for half a second, that the account is empty.
 * Only a later change (a top-up landing, a turn being spent) is animated, over 600ms with
 * an ease-out, and not at all for a reader who prefers reduced motion. `format` turns the
 * in-between values into text, so the sentence around the number stays the caller's.
 */
export function AnimatedNumber({
  value,
  format,
  className,
  ...rest
}: {
  value: number;
  format: (n: number) => string;
  className?: string;
} & React.HTMLAttributes<HTMLSpanElement>) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);

  useEffect(() => {
    const start = from.current;
    if (
      start === value ||
      typeof window === 'undefined' ||
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    ) {
      from.current = value;
      setShown(value);
      return;
    }
    const began = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - began) / 600);
      const eased = 1 - (1 - progress) ** 3;
      const next = start + (value - start) * eased;
      from.current = next;
      setShown(next);
      if (progress < 1) frame = requestAnimationFrame(tick);
      else from.current = value;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return (
    <span className={className} {...rest}>
      {format(shown === value ? value : Math.round(shown * 10) / 10)}
    </span>
  );
}
