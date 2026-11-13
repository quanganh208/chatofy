'use client';

import type { CreditBalance, PaymentRail } from '@chatofy/types';
import { useTranslate } from '@/i18n/provider';

const RAILS = ['polar', 'sepay'] as const satisfies readonly PaymentRail[];

/**
 * The one quiet line under the plans about buying at all: why every Upgrade and Buy
 * is dead (checkout is not open to this account, or the API just refused it), else
 * which rails are in test mode. Named per rail, because one rail can be live while
 * the other is a sandbox and a single "test mode" line would then sit under buttons
 * that charge real money. With nothing to say it is not drawn at all, so it adds no
 * empty row (and no divider) to the group.
 */
export function CheckoutNotice({
  balance,
  closedId,
  refused,
}: {
  balance: CreditBalance;
  closedId: string;
  refused: boolean;
}) {
  const t = useTranslate();
  if (!balance.checkoutAllowed || refused) {
    return (
      <p id={closedId} className="text-muted-foreground text-hint max-w-prose py-3">
        {t('common.billing.checkoutClosed')}
      </p>
    );
  }
  const sandbox = RAILS.filter((rail) => balance.rails[rail] === 'sandbox');
  if (sandbox.length === 0) return null;
  return (
    <p
      className="text-muted-foreground text-hint max-w-prose py-3"
      data-rail-sandbox={sandbox.join(' ')}
    >
      {sandbox.length === 2
        ? t('web.billing.railSandboxBoth')
        : t(sandbox[0] === 'polar' ? 'web.account.railSandboxCard' : 'web.account.railSandboxQr')}
    </p>
  );
}
