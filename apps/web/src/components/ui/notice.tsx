import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * A message the page needs someone to read: an error, or a state they can act on.
 *
 * Written inline four times before this existed, in three different shapes — two
 * `bg-live-subtle` blocks with `role="alert"`, one `bg-warning-subtle` block with
 * `role="status"`, and, on the turn-based page, a bare coloured paragraph with **no
 * role at all**. That last one is why this is not a pure refactor: consolidating it
 * gives the baseline page's mic and translate errors an `alert` role they never had,
 * so a screen reader is told about a failed turn instead of leaving it on screen for
 * someone to notice.
 *
 * Tone drives the role, and that pairing is the point rather than a convenience.
 * `live` means something failed and the reader is interrupted; `warning` means the
 * output may be wrong but the session is fine, which is a status, not an alert. A
 * caller that needs the other role has a tone problem, not a markup problem.
 *
 * Both tones put `text` on a subtle fill rather than tinting the text itself. The
 * `live`/`warning` hues are reserved for fills and indicators — see
 * `docs/design-guidelines.md` § State — and coloured body copy on a dark ground
 * reads as decoration at exactly the moment it needs to read as information.
 */
const noticeVariants = cva('rounded-md px-4 py-3 text-body', {
  variants: {
    tone: {
      live: 'bg-live-subtle text-foreground',
      warning: 'bg-warning-subtle text-foreground',
    },
  },
  defaultVariants: { tone: 'live' },
});

const ROLE_FOR_TONE = { live: 'alert', warning: 'status' } as const;

type NoticeProps = React.HTMLAttributes<HTMLParagraphElement> & VariantProps<typeof noticeVariants>;

export function Notice({ className, tone = 'live', ...props }: NoticeProps) {
  return (
    <p
      role={ROLE_FOR_TONE[tone ?? 'live']}
      className={cn(noticeVariants({ tone }), className)}
      {...props}
    />
  );
}
