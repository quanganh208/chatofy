'use client';

import { cn } from '@/lib/utils';

/**
 * One capability, and what is currently true about it.
 *
 * Not `StatusIndicator`. That component answers "what is the session doing" — its
 * tones are `live`, `speaking`, `busy`, `idle` — and there is no honest mapping from
 * a granted permission onto any of them. What the two genuinely share is the pill,
 * and both take it from `Badge`.
 *
 * Three tones, because three is what the answers reduce to: it is fine, it is a
 * problem, or nothing is known yet. `unknown` is a first-class result here rather
 * than a loading state to be hidden — the Permissions API does not answer in every
 * browser, and a row that quietly showed `ok` in those would be the exact failure
 * this card exists to avoid.
 *
 * No pulse. Nothing on this page is live, and a repeating animation beside a static
 * fact reads as something being measured continuously.
 */

export type ReadinessTone = 'ok' | 'problem' | 'unknown';

const DOT: Record<ReadinessTone, string> = {
  ok: 'bg-speaking',
  problem: 'bg-live',
  unknown: 'bg-muted-foreground',
};

export function ReadinessRow({
  label,
  tone,
  value,
}: {
  label: string;
  tone: ReadinessTone;
  value: string;
}) {
  return (
    <div className="border-hairline flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-b pb-3 last:border-b-0 last:pb-0">
      <span className="text-body text-prose">{label}</span>
      <span className="text-hint flex items-center gap-2 font-semibold">
        <span aria-hidden className={cn('size-2 shrink-0 rounded-full', DOT[tone])} />
        {value}
      </span>
    </div>
  );
}
