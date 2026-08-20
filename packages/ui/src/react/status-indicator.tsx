import { cn } from '../lib/utils.js';

/**
 * What the session is doing, as a state rather than a sentence.
 *
 * Both panels already mapped their hook's status to prose and rendered it as grey
 * text beside a spinner, which meant every state looked the same until you read
 * it. The prose stays — it is added to, not replaced.
 *
 * That is deliberate and worth defending: `live` is red and `speaking` is green,
 * they appear next to each other on the same dot, and that is the textbook
 * red-green failure. The label is what makes them distinguishable to a colour
 * blind reader, and the pulse is the second signal — `live` pulses, nothing else
 * does. A reviewer who calls the label redundant now that there is a colour is
 * wrong.
 */

export type StatusTone = 'idle' | 'busy' | 'live' | 'speaking';

const TONE: Record<StatusTone, { dot: string; text: string; pulse: boolean }> = {
  idle: { dot: 'bg-muted-foreground', text: 'text-muted-foreground', pulse: false },
  busy: { dot: 'bg-primary', text: 'text-foreground', pulse: false },
  live: { dot: 'bg-live', text: 'text-foreground', pulse: true },
  speaking: { dot: 'bg-speaking', text: 'text-foreground', pulse: false },
};

interface StatusIndicatorProps {
  tone: StatusTone;
  /** The words. Never omitted — see the note above. */
  label: string;
  className?: string;
}

export function StatusIndicator({ tone, label, className }: StatusIndicatorProps) {
  const { dot, text, pulse } = TONE[tone];
  return (
    // `role="status"` only. It already implies `aria-live="polite"` and
    // `aria-atomic`, and declaring both had some screen readers treat the element
    // as two overlapping regions.
    <span role="status" className={cn('inline-flex items-center gap-2 text-body', text, className)}>
      <span className="relative flex size-2 shrink-0" aria-hidden>
        {/* The halo, not the dot: animating the dot itself makes the label jitter
            in some renderers, and this is legible at a glance from further away. */}
        {pulse ? (
          <span
            className={cn(
              'absolute inline-flex size-full animate-ping rounded-full',
              // The pulse is the second signal that distinguishes `live` from
              // `speaking`, so removing it costs something — but the label carries
              // the difference on its own, and a repeating animation someone asked
              // not to see is not negotiable.
              'motion-reduce:hidden',
              dot,
            )}
            style={{ animationDuration: '1.6s' }}
          />
        ) : null}
        <span className={cn('relative inline-flex size-2 rounded-full', dot)} />
      </span>
      {label}
    </span>
  );
}
