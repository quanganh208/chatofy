'use client';

import { Check } from 'lucide-react';
import { useTranslate } from '@/i18n/provider';
import { cn } from '@/lib/utils';

/** One plan: its name, what it gives, what it costs, and — when it is yours — a mark. */
export function PlanColumn({
  id,
  name,
  current,
  summary,
  prices = [],
  status,
  children,
}: {
  id: 'free' | 'pro';
  name: string;
  current: boolean;
  summary?: string;
  prices?: string[];
  status?: string;
  children?: React.ReactNode;
}) {
  const t = useTranslate();
  return (
    <div
      data-plan-column={id}
      data-current-plan={current || undefined}
      className={cn(
        'flex flex-col gap-3 rounded-md border p-4',
        current ? 'border-border-strong' : 'border-hairline',
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-translation font-medium">{name}</span>
        {current ? (
          <span className="text-muted-foreground text-hint flex items-center gap-1">
            <Check aria-hidden className="size-3.5" />
            {t('web.billing.yourPlan')}
          </span>
        ) : null}
      </div>
      {summary ? <p className="text-prose text-hint">{summary}</p> : null}
      {prices.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {prices.map((price) => (
            <li key={price} className="text-body tabular-nums">
              {price}
            </li>
          ))}
        </ul>
      ) : null}
      {status ? <p className="text-body font-medium">{status}</p> : null}
      {children ? <div className="mt-auto flex flex-col gap-2 pt-1">{children}</div> : null}
    </div>
  );
}
