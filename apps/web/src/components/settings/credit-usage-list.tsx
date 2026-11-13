'use client';

import Link from 'next/link';
import type { CreditUsageKind } from '@chatofy/types';
import type { MessageKey } from '@chatofy/i18n';
import { Button, Skeleton } from '@chatofy/ui/react';
import type { UseCreditUsage } from '@/hooks/use-credits';
import { useLocale, useTranslate } from '@/i18n/provider';
import { formatCredits, formatDay } from '@/lib/credit-format';

const KIND_KEY: Record<CreditUsageKind, MessageKey> = {
  translate: 'common.billing.usageKind.translate',
  minutes: 'common.billing.usageKind.minutes',
  grant: 'common.billing.usageKind.grant',
  refund: 'common.billing.usageKind.refund',
  expire: 'common.billing.usageKind.expire',
  void: 'common.billing.usageKind.void',
};

/**
 * What the credits went on, newest first: rows inside the "Usage" group's hairline
 * box, one per entry, never a card per row.
 *
 * A row whose spend belongs to a saved conversation links to it in history,
 * which is what the conversation id sent on every session start is for. The
 * amount is signed and tabular so a column of spends reads at a glance.
 *
 * The server's own label is shown only on grants, where it names the source
 * (Free month, Pro, a top-up). On every other row the kind already says it in
 * the reader's language, and the label would repeat it in English.
 */
export function CreditUsageList({ usage }: { usage: UseCreditUsage }) {
  const t = useTranslate();
  const locale = useLocale();

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
      <ul className="divide-hairline flex flex-col divide-y" data-credit-usage-list>
        {usage.entries.map((entry) => {
          const amount = formatCredits(t, locale, Math.abs(entry.credits));
          return (
            <li
              key={entry.id}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 py-3"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-body">{t(KIND_KEY[entry.kind])}</span>
                <span className="text-muted-foreground text-hint">
                  {formatDay(locale, entry.at)}
                  {entry.kind === 'grant' && entry.label ? ` · ${entry.label}` : null}
                  {entry.conversationId ? (
                    <>
                      {' · '}
                      <Link
                        href={`/history/${encodeURIComponent(entry.conversationId)}`}
                        className="text-accent-text underline underline-offset-4 hover:decoration-2"
                      >
                        {t('common.billing.usageOpenConversation')}
                      </Link>
                    </>
                  ) : null}
                </span>
              </div>
              <span className="text-body font-medium tabular-nums">
                {entry.credits < 0 ? '−' : entry.credits > 0 ? '+' : ''}
                {amount}
              </span>
            </li>
          );
        })}
      </ul>
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
