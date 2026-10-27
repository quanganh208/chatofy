import { dawn } from '@chatofy/ui';

/**
 * The brand's dawn trio as one gradient. Decoration only, and never behind text
 * (`docs/design-guidelines.md`, Dawn): it glows behind a region and rings the
 * camera-off initials, whose own disc is neutral.
 */
export const DAWN_GRADIENT = `linear-gradient(135deg, ${dawn.peach}, ${dawn.lavender}, ${dawn.mint})`;

/**
 * A soft dawn glow filling its positioned parent, drawn behind the parent's
 * content. Stronger in light: pale dawn on stone all but vanishes at 40%.
 */
export function DawnGlow({ className = '-inset-6' }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute rounded-[2rem] opacity-70 blur-3xl dark:opacity-40 ${className}`}
      style={{ backgroundImage: DAWN_GRADIENT }}
    />
  );
}
