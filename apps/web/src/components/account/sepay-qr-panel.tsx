'use client';

import { useState } from 'react';
import { Button } from '@chatofy/ui/react';
import type { CheckoutOrder } from '@chatofy/types';
import type { SepayCheckout } from '@/components/account/credit-buy-actions';
import { useCheckoutOrder } from '@/hooks/use-credits';
import { useLocale, useTranslate } from '@/i18n/provider';
import { formatVnd } from '@/lib/pricing-content';

/**
 * The VietQR to pay one SePay order, inline under the buy buttons.
 *
 * **Not a card.** `/account` draws one elevated surface — the security panel —
 * and this is a region on the page ground with a hairline, so opening it keeps
 * the screen at one. Close is ghost, so it keeps the accent count at zero.
 *
 * **The code and amount are text as well as a picture.** A QR is unreadable to
 * a screen reader and to anyone paying from the same phone the page is on; the
 * transfer note is how the webhook finds the order, so it is copyable and the
 * hint says to keep it exact.
 *
 * **Polling** is `useCheckoutOrder`: every 3 s, stopped at a settled status or
 * when this unmounts. An expired order is still watched, slower and for a
 * bounded while, because a transfer that lands late is still credited. The outcome line is an `aria-live="polite"` region that
 * exists before its text changes, so "payment received" is announced.
 */
export function SepayQrPanel({
  order,
  onPaid,
  onClose,
}: {
  order: SepayCheckout;
  /** The transfer landed: refetch the balance and usage. */
  onPaid: () => void;
  onClose: () => void;
}) {
  const t = useTranslate();
  const locale = useLocale();
  const [copied, setCopied] = useState<'code' | 'amount' | null>(null);
  const status = useCheckoutOrder(order.orderId, (settled: CheckoutOrder) => {
    if (settled.status === 'paid' || settled.status === 'resolved_granted') onPaid();
  });
  const amount = formatVnd(order.amountVnd, locale);

  const copy = (what: 'code' | 'amount', text: string) => {
    // A refused clipboard (no permission, insecure origin) leaves the text on
    // screen to copy by hand, so it is not worth a failure line.
    navigator.clipboard?.writeText(text).then(
      () => setCopied(what),
      () => setCopied(null),
    );
  };

  return (
    <div
      className="border-border flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-start sm:gap-5"
      data-sepay-qr-panel
    >
      {/* A plain <img>, not next/image: a one-time payment code must not pass
          through the image optimiser's cache. The white ground keeps the code
          scannable on the dark theme; `img-src` admits vietqr.app for it. */}
      <img
        src={order.qrUrl}
        alt={t('web.account.qrImageAlt', { amount })}
        width={200}
        height={200}
        className="size-[200px] shrink-0 self-center rounded-md bg-white sm:self-start"
      />
      <div className="flex min-w-0 flex-col gap-2.5">
        <span className="text-body font-medium">{t('web.account.qrTitle')}</span>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5">
          <dt className="text-muted-foreground text-hint">{t('web.account.qrAmount')}</dt>
          <dd className="text-body font-medium tabular-nums">{amount}</dd>
          <dd>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => copy('amount', String(order.amountVnd))}
            >
              {copied === 'amount' ? t('web.account.qrCopied') : t('web.account.qrCopy')}
            </Button>
          </dd>
          <dt className="text-muted-foreground text-hint">{t('web.account.qrCode')}</dt>
          <dd className="text-body font-medium break-all">{order.orderCode}</dd>
          <dd>
            <Button variant="ghost" size="sm" onClick={() => copy('code', order.orderCode)}>
              {copied === 'code' ? t('web.account.qrCopied') : t('web.account.qrCopy')}
            </Button>
          </dd>
        </dl>
        <p className="text-muted-foreground text-hint max-w-prose">{t('web.account.qrCodeHint')}</p>
        <p aria-live="polite" className="text-prose text-hint" data-qr-status>
          {statusLine(t, status?.status)}
        </p>
        <Button variant="ghost" size="sm" className="self-start" onClick={onClose}>
          {t('web.account.qrClose')}
        </Button>
      </div>
    </div>
  );
}

/**
 * What the order's state means to the payer. A transfer held for review has
 * landed but was not matched, so "waiting" would be untrue: it says the owner
 * resolves it by hand. Polling stops there too, since only that review moves it.
 */
function statusLine(
  t: ReturnType<typeof useTranslate>,
  status: CheckoutOrder['status'] | undefined,
): string {
  if (status === undefined || status === 'pending') return t('web.account.qrWaiting');
  if (status === 'paid' || status === 'resolved_granted') return t('web.account.qrPaid');
  if (status === 'expired' || status === 'resolved_dismissed') return t('web.account.qrExpired');
  return t('web.account.qrNeedsReview');
}
