'use client';

import Link from 'next/link';
import {
  Ban,
  ChevronRight,
  Gift,
  Hourglass,
  Languages,
  Undo2,
  Video,
  type LucideIcon,
} from 'lucide-react';
import type { CreditUsageEntry, CreditUsageKind } from '@chatofy/types';
import type { MessageKey } from '@chatofy/i18n';
import { Button, Skeleton } from '@chatofy/ui/react';
import type { UseCreditUsage } from '@/hooks/use-credits';
import { useLocale, useTranslate } from '@/i18n/provider';
import { formatCredits, formatDay } from '@/lib/credit-format';
import { cn } from '@/lib/utils';
import { groupUsageByDay, type UsageDay } from './credit-usage-days';

const KIND: Record<CreditUsageKind, { label: MessageKey; icon: LucideIcon }> = {
  translate: { label: 'common.billing.usageKind.translate', icon: Languages },
  minutes: { label: 'common.billing.usageKind.minutes', icon: Video },
  grant: { label: 'common.billing.usageKind.grant', icon: Gift },
  refund: { label: 'common.billing.usageKind.refund', icon: Undo2 },
  expire: { label: 'common.billing.usageKind.expire', icon: Hourglass },
  void: { label: 'common.billing.usageKind.void', icon: Ban },
};

/**
 * What the credits went on, newest first, under a heading per day — "Today",
 * "Yesterday", then the date in the reader's calendar. Each day is one row of the
 * "Usage" group's hairline box; its entries are rows inside it, never a card each.
 *
 * Every entry has an icon for its kind, its name and time on the left, and the signed
 * amount right-aligned in tabular figures, so a column of spends reads at a glance.
 * A spend is plain foreground — spending is what credits are for, so it is never
 * drawn as an error — and anything added (a grant, a refund) is `+` in the quiet
 * `speaking` green.
 *
 * An entry whose spend belongs to a saved conversation is a link to it in history,
 * which is what the conversation id sent on every session start is for.
 *
 * The server's own label is shown only on grants, where it names the source
 * (Free month, Pro, a top-up). On every other row the kind already says it in
 * the reader's language, and the label would repeat it in English.
 */
export function CreditUsageList({ usage }: { usage: UseCreditUsage }) {
  const t = useTranslate();

  // Every branch returns rows of the enclosing group's box: the box pads each one and
  // draws the divider between them, so nothing here sets a horizontal inset or a
  // border against the box edge.
  if (usage.state === 'loading') {
    return (
      <div className="py-3.5">
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }
  if (usage.state === 'failed') {
    return (
      <p className="text-muted-foreground text-hint py-3.5">
        {t('common.billing.usageLoadFailed')}
      </p>
    );
  }
  if (usage.entries.length === 0) {
    return (
      <p className="text-muted-foreground text-hint py-3.5">{t('common.billing.usageEmpty')}</p>
    );
  }

  return (
    <>
      {groupUsageByDay(usage.entries).map((day) => (
        <UsageDayRows key={day.key} day={day} />
      ))}
      {usage.hasMore || usage.moreFailed ? (
        <div className="flex flex-col items-start gap-1 py-2">
          {usage.hasMore ? (
            // Pulled left by its own padding so its label lines up with the rows'.
            <Button
              variant="ghost"
              size="sm"
              className="-mx-3"
              disabled={usage.loadingMore}
              onClick={usage.loadMore}
            >
              {t('web.account.usageShowMore')}
            </Button>
          ) : null}
          {usage.moreFailed ? (
            <p role="alert" className="text-muted-foreground text-hint py-1">
              {t('common.billing.usageLoadFailed')}
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

/** One day: its heading, then its entries. */
function UsageDayRows({ day }: { day: UsageDay }) {
  const t = useTranslate();
  const locale = useLocale();
  const heading =
    day.daysAgo === 0
      ? t('web.billing.usageToday')
      : day.daysAgo === 1
        ? t('web.billing.usageYesterday')
        : formatDay(locale, day.at);
  return (
    <section className="flex flex-col pt-3 pb-1" data-usage-day={day.key}>
      <h4 className="text-muted-foreground text-label font-semibold tracking-wide uppercase">
        {heading}
      </h4>
      <ul className="divide-hairline flex flex-col divide-y" data-credit-usage-list>
        {day.entries.map((entry) => (
          <li key={entry.id}>
            <UsageEntryRow entry={entry} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** One entry: kind icon, name and time, signed amount; a link when it has a conversation. */
function UsageEntryRow({ entry }: { entry: CreditUsageEntry }) {
  const t = useTranslate();
  const locale = useLocale();
  const { label, icon: Icon } = KIND[entry.kind];
  const amount = formatCredits(t, locale, Math.abs(entry.credits));
  const sign = entry.credits < 0 ? '−' : entry.credits > 0 ? '+' : '';
  const body = (
    <>
      <Icon aria-hidden className="text-muted-foreground size-4 shrink-0" />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-body">{t(label)}</span>
        <span className="text-muted-foreground text-hint tabular-nums">
          {formatTime(locale, entry.at)}
          {entry.kind === 'grant' && entry.label ? ` · ${entry.label}` : null}
        </span>
      </span>
      <span
        className={cn(
          'text-body justify-self-end font-medium whitespace-nowrap tabular-nums',
          entry.credits > 0 && 'text-speaking',
        )}
      >
        {sign}
        {amount}
      </span>
    </>
  );
  const grid = 'grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 py-3';

  if (!entry.conversationId) return <div className={grid}>{body}</div>;
  return (
    // The whole row is the link; it reaches past the box's inset by the same amount it
    // pads, so its hover ground is wider than the text without moving the text.
    <Link
      href={`/history/${encodeURIComponent(entry.conversationId)}`}
      className={cn(
        grid,
        'hover:bg-muted/60 focus-visible:ring-ring/50 -mx-2 grid-cols-[auto_minmax(0,1fr)_auto_auto] rounded-md px-2 outline-none focus-visible:ring-[3px]',
      )}
    >
      {body}
      <ChevronRight aria-hidden className="text-muted-foreground size-4" />
      <span className="sr-only">{t('common.billing.usageOpenConversation')}</span>
    </Link>
  );
}

/** The time of day an entry was written, in the reader's clock. */
function formatTime(locale: string, iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}
