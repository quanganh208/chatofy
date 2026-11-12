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
 * What the credits went on, newest first: a list on the page ground, one row
 * per entry, never a card per row.
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

  if (usage.state === 'loading') {
    return <Skeleton className="h-10 w-full" />;
  }
  if (usage.state === 'failed') {
    return <p className="text-muted-foreground text-hint">{t('common.billing.usageLoadFailed')}</p>;
  }
  if (usage.entries.length === 0) {
    return <p className="text-muted-foreground text-hint">{t('common.billing.usageEmpty')}</p>;
  }

  return (
    <div className="flex flex-col">
      <ul className="flex flex-col" data-credit-usage-list>
        {usage.entries.map((entry) => {
          const amount = formatCredits(t, locale, Math.abs(entry.credits));
          return (
            <li
              key={entry.id}
              className="border-hairline grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 border-b py-2.5 last:border-b-0"
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
      {usage.hasMore ? (
        <Button
          variant="ghost"
          size="sm"
          className="mt-1 self-start"
          disabled={usage.loadingMore}
          onClick={usage.loadMore}
        >
          {t('web.account.usageShowMore')}
        </Button>
      ) : null}
      {usage.moreFailed ? (
        <p role="alert" className="text-muted-foreground text-hint">
          {t('common.billing.usageLoadFailed')}
        </p>
      ) : null}
    </div>
  );
}
