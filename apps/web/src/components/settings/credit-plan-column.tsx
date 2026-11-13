'use client';

import { Check, CircleCheck } from 'lucide-react';
import { useTranslate } from '@/i18n/provider';
import { cn } from '@/lib/utils';

/**
 * One plan in the Free | Pro comparison. Both columns have the same structure so
 * their parts line up across: the name (and "Your plan" on the current one), the
 * price — the first line large, a second rail's price under it — then a short
 * list of what you get, then where the current plan stands, then actions pinned
 * to the bottom.
 *
 * A hairline region on the pane ground with no shadow, not a card; the current
 * plan's edge is `border-strong`, never a fill, because a fill would read as a
 * control and the tab's one accent belongs to Upgrade.
 */
export function PlanColumn({
  id,
  name,
  current,
  prices,
  features,
  status,
  children,
}: {
  id: 'free' | 'pro';
  name: string;
  current: boolean;
  /** First line is the headline price; any further line is another rail's. */
  prices: string[];
  features: string[];
  status?: string;
  children?: React.ReactNode;
}) {
  const t = useTranslate();
  const [headline, ...others] = prices;
  return (
    <div
      data-plan-column={id}
      data-current-plan={current || undefined}
      className={cn(
        'flex flex-col gap-4 rounded-lg border p-4',
        current ? 'border-border-strong' : 'border-hairline',
      )}
    >
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-3">
          <span className="text-body font-semibold">{name}</span>
          {current ? (
            <span className="text-muted-foreground text-hint flex items-center gap-1">
              <CircleCheck aria-hidden className="size-3.5" />
              {t('web.billing.yourPlan')}
            </span>
          ) : null}
        </div>
        {headline ? (
          <span className="text-heading font-display leading-tight font-light text-balance tabular-nums">
            {headline}
          </span>
        ) : null}
        {others.map((price) => (
          <span key={price} className="text-prose text-body tabular-nums">
            {price}
          </span>
        ))}
      </div>
      {features.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {features.map((feature) => (
            <li key={feature} className="text-body flex items-start gap-2">
              <Check aria-hidden className="text-muted-foreground mt-0.5 size-4 shrink-0" />
              {feature}
            </li>
          ))}
        </ul>
      ) : null}
      {status ? <p className="text-body font-medium">{status}</p> : null}
      {children ? <div className="mt-auto flex flex-col gap-2 pt-1">{children}</div> : null}
    </div>
  );
}
