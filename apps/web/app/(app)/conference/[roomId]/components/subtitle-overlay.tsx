'use client';

/**
 * Subtitle overlay rendered on top of a video tile.
 *
 * Displays the peer's current subtitle text from the translation pipeline.
 * Final subtitles are solid; partial (in-progress) subtitles are dimmed.
 * Pure readout — no interaction.
 *
 * The `isFinal` flag is not currently in PeerState (Phase 3 adds per-turn
 * tracking); we receive the raw `subtitle` string only. When the hook
 * provides the text, we render it solid. This component is designed so
 * Phase 3 can pass an `isFinal` prop without a breaking change.
 */

const SIZE_CLASS = {
  sm: 'text-hint',
  md: 'text-body',
  lg: 'text-translation',
  xl: 'text-heading',
} as const;

interface SubtitleOverlayProps {
  subtitle: string | undefined;
  /** The reader's caption size; the product's own type roles, not arbitrary pixels. */
  size?: keyof typeof SIZE_CLASS;
  /** When false the text is dimmed to signal an in-progress partial. */
  isFinal?: boolean;
}

export function SubtitleOverlay({ subtitle, isFinal = true, size = 'md' }: SubtitleOverlayProps) {
  if (!subtitle) return null;

  return (
    <div
      className="absolute right-0 bottom-0 left-0 px-2 py-2"
      aria-live="polite"
      aria-atomic="true"
    >
      <p
        className={[
          'inline rounded px-2 py-1',
          // Scrim: black/80 gives ≈18:1 white-on-black — well above the 4.5:1 AA
          // floor. Opacity is on the ELEMENT (readout), not on the foreground text,
          // so the white/scrim pair is evaluated at full values.
          'bg-black/80 text-white',
          // 14px by default; the reader can step it up. 11px is never offered.
          `${SIZE_CLASS[size]} leading-snug`,
          // Final subtitles are solid; partials are dimmed to signal in-progress.
          isFinal ? 'opacity-100' : 'opacity-60',
        ].join(' ')}
      >
        {subtitle}
      </p>
    </div>
  );
}
