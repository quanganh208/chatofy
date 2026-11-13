'use client';

import type { CreditBalance } from '@chatofy/types';
import { dawn } from '@chatofy/ui';
import { AnimatedNumber } from '@/components/motion/animated-number';
import { useLocale, useTranslate } from '@/i18n/provider';
import { formatCredits, formatDay } from '@/lib/credit-format';

/** The dawn gradient plan credits are drawn in, on the bar and on its legend swatch. */
const PLAN_FILL = `linear-gradient(90deg, ${dawn.peach}, ${dawn.lavender}, ${dawn.mint})`;

/**
 * The top row of Settings › Billing: the total, big, then the split between this
 * period's plan credits and top-ups — as a bar at a glance, and as a two-entry legend
 * in words underneath.
 *
 * The legend is the split's accessible form: the bar is `aria-hidden`, and each
 * legend entry says its kind, its amount and when it ends (plan credits reset, top-ups
 * never expire). Two columns from `sm` up, stacked on a phone.
 *
 * It is one row of the group's hairline box, so it draws no border of its own; the
 * box's divider separates it from the plan row below.
 */
export function BalanceSummary({ balance }: { balance: CreditBalance }) {
  const t = useTranslate();
  const locale = useLocale();

  return (
    <div className="flex flex-col gap-4 py-5" data-credit-balance>
      <div className="flex flex-col gap-1.5">
        <span className="text-muted-foreground text-hint">{t('common.billing.totalCredits')}</span>
        <AnimatedNumber
          data-credit-total
          value={balance.totalCredits}
          format={(n) => formatCredits(t, locale, n)}
          className="text-title font-display leading-none font-light tabular-nums"
        />
      </div>
      <div aria-hidden className="bg-muted flex h-1.5 w-full overflow-hidden rounded-full">
        <span
          className="duration-slow ease-standard h-full transition-[width] motion-reduce:transition-none"
          style={{
            width: `${share(balance.planCredits, balance.totalCredits)}%`,
            backgroundImage: PLAN_FILL,
          }}
        />
        <span
          className="bg-muted-foreground/60 duration-slow ease-standard h-full transition-[width] motion-reduce:transition-none"
          style={{ width: `${share(balance.topupCredits, balance.totalCredits)}%` }}
        />
      </div>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
        <LegendEntry
          swatch={<span className="size-2 rounded-full" style={{ backgroundImage: PLAN_FILL }} />}
          label={t('common.billing.planCredits')}
          amount={formatCredits(t, locale, balance.planCredits)}
          note={
            balance.planResetsAt
              ? t('common.billing.planResetsOn', { date: formatDay(locale, balance.planResetsAt) })
              : undefined
          }
        />
        <LegendEntry
          swatch={<span className="bg-muted-foreground/60 size-2 rounded-full" />}
          label={t('common.billing.topupCredits')}
          amount={formatCredits(t, locale, balance.topupCredits)}
          note={t('common.billing.topupNeverExpire')}
        />
      </dl>
    </div>
  );
}

/** One kind of credit: a swatch matching its bar segment, its name, amount and term. */
function LegendEntry({
  swatch,
  label,
  amount,
  note,
}: {
  swatch: React.ReactNode;
  label: string;
  amount: string;
  note?: string;
}) {
  return (
    // The swatch sits inside the `dt`: a `div` in a `dl` may hold only `dt` and `dd`.
    // The two `dd`s are indented by the swatch's width plus the gap, under the label.
    <div className="flex flex-col gap-0.5">
      <dt className="text-muted-foreground text-hint flex items-center gap-2.5">
        <span aria-hidden className="flex shrink-0">
          {swatch}
        </span>
        {label}
      </dt>
      <dd className="text-body pl-4.5 font-medium tabular-nums">{amount}</dd>
      {note ? <dd className="text-muted-foreground text-hint pl-4.5">{note}</dd> : null}
    </div>
  );
}

/** `part` as a percentage of `whole`, 0 when there is nothing to divide. */
function share(part: number, whole: number): number {
  return whole > 0 ? Math.min(100, Math.max(0, (part / whole) * 100)) : 0;
}
