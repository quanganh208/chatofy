import { brandMark, dawn } from '@chatofy/ui';
import { cn } from '@/lib/utils';

/**
 * The hero's five-petal lotus: the brand mark grown into an illustration.
 *
 * Decorative and nothing else — `aria-hidden`, no text inside or behind it, and it
 * stands ABOVE the demo card rather than under it, because a dawn value measures
 * 1.3–1.7:1 on stone and must never be what a sentence is read against.
 *
 * Sky and rose are the mark's side-petal stops, not palette values. They are two
 * extra stops the outer petals need to read as five rather than three; the
 * palette's `dawn` trio stays three.
 *
 * The gradient ids are fixed because the landing renders exactly one of these; a
 * second instance on one page would need `useId`, as `BrandMark` does.
 *
 * It opens once on load — every petal starting upright and turning out to its
 * resting angle — and then stays still. No loop, no reaction to anything, and
 * under reduced motion nothing moves at all: `motion-reduce:animate-none` leaves the
 * resting transform, which is the inline style, in place from the first frame.
 */
// The mark's own side-petal stops, so the illustration and the mark cannot drift.
const SKY = brandMark.sideStops.left.to;
const ROSE = brandMark.sideStops.right.to;

/** One petal, base at the origin, tip straight up. */
const PETAL = 'M0 -170 C50 -112 52 -40 0 0 C-52 -40 -50 -112 0 -170 Z';

const PETALS = [
  { angle: -66, fill: 'left', opacity: 0.5 },
  { angle: 66, fill: 'right', opacity: 0.5 },
  { angle: -33, fill: 'left', opacity: 0.7 },
  { angle: 33, fill: 'right', opacity: 0.7 },
  { angle: 0, fill: 'centre', opacity: 0.92 },
] as const;

export function LotusIllustration({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      focusable="false"
      data-slot="lotus-illustration"
      // The origin is the shared base, so each petal's CSS rotation turns about it
      // without a transform-origin of its own.
      viewBox="-215 -182 430 204"
      className={cn('w-full', className)}
    >
      <defs>
        <linearGradient id="lotus-centre" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={dawn.peach} />
          <stop offset=".55" stopColor={dawn.lavender} />
          <stop offset="1" stopColor={dawn.mint} />
        </linearGradient>
        <linearGradient id="lotus-left" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={SKY} />
          <stop offset="1" stopColor={dawn.mint} />
        </linearGradient>
        <linearGradient id="lotus-right" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={ROSE} />
          <stop offset="1" stopColor={dawn.lavender} />
        </linearGradient>
      </defs>
      {PETALS.map(({ angle, fill, opacity }) => (
        <path
          key={angle}
          d={PETAL}
          fill={`url(#lotus-${fill})`}
          opacity={opacity}
          style={{ transform: `rotate(${angle}deg)` }}
          className="motion-safe:animate-lotus-bloom motion-reduce:animate-none"
        />
      ))}
    </svg>
  );
}
