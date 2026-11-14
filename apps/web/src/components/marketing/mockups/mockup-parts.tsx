import { cn } from '@/lib/utils';

/**
 * The small pieces every landing mockup is drawn from.
 *
 * A mockup is a still life of a product screen built from the product's own tokens, not
 * a screenshot: it renders in both themes, never goes stale against a capture, and costs
 * no image request. It is decoration, so the frame is `aria-hidden` — the tile around it
 * says in words what the picture shows, and a screen reader would otherwise read a
 * conversation that never happened as if it were content.
 *
 * Nothing here is a control. A mockup holds no `button` or `a`, so it can never spend
 * the accent budget or take a tab stop, and nothing in it carries a hover state.
 */
export function MockupFrame({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={cn(
        'border-hairline bg-card pointer-events-none flex flex-col gap-3 rounded-xl border p-4 select-none',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** A quiet pill: a language, a mode, a readout. Never filled with the accent. */
export function MockupChip({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'border-hairline bg-background text-hint inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-medium whitespace-nowrap',
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * One turn as the translator draws it: the source quiet, the translation as the larger
 * line. Getting that hierarchy backwards in a picture would teach the wrong thing.
 */
export function MockupTurn({
  label,
  source,
  target,
  size = 'md',
}: {
  label?: string;
  source: string;
  target: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {label ? <p className="text-hint text-muted-foreground">{label}</p> : null}
      <p className="text-muted-foreground text-body">{source}</p>
      <p
        className={cn(
          'text-foreground font-medium',
          size === 'md' ? 'text-translation' : 'text-body',
        )}
      >
        {target}
      </p>
    </div>
  );
}
