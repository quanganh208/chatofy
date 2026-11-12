'use client';

import { dawn } from '@chatofy/ui';
import { Skeleton } from '@chatofy/ui/react';
import { useCreditBalance } from '@/hooks/use-credits';
import { useLocale, useTranslate } from '@/i18n/provider';
import { formatCredits } from '@/lib/credit-format';
import { cn } from '@/lib/utils';

/**
 * The balance in one line and a hairline meter, for the sidebar footer and the More sheet.
 *
 * **Gone on failure, not an error.** The chrome is on every screen; a billing read that
 * failed is `/settings/billing`'s to explain, and a red line under your name on the translator
 * would say something is wrong with the conversation. Loading holds the line's height
 * so the footer does not jump when the number lands.
 *
 * **What the meter measures.** The balance carries no allowance to divide by, so the
 * bar is the same split `/settings/billing` draws: this period's plan credits in the dawn,
 * top-ups in the muted track. Decorative — the text says the number, so a screen reader
 * hears it once.
 */
export function CreditLine({ className }: { className?: string }) {
  const t = useTranslate();
  const locale = useLocale();
  const { balance, state } = useCreditBalance();

  if (state === 'failed' && balance === null) return null;
  if (balance === null) {
    return <Skeleton data-slot="credit-line" className={cn('h-3 w-20', className)} />;
  }

  const planShare =
    balance.totalCredits > 0
      ? Math.min(100, Math.round((balance.planCredits / balance.totalCredits) * 100))
      : 0;

  return (
    <span data-slot="credit-line" className={cn('flex min-w-0 flex-col gap-1', className)}>
      <span className="text-muted-foreground text-hint truncate tabular-nums">
        {t('web.chrome.creditsLeft', {
          amount: formatCredits(t, locale, balance.totalCredits),
        })}
      </span>
      <span aria-hidden className="bg-muted flex h-1 w-full overflow-hidden rounded-full">
        <span
          className="h-full"
          style={{
            width: `${planShare}%`,
            backgroundImage: `linear-gradient(90deg, ${dawn.peach}, ${dawn.lavender}, ${dawn.mint})`,
          }}
        />
      </span>
    </span>
  );
}
