'use client';

import { useId, useState } from 'react';
import type { CreditBalance, PaymentRail, Plan } from '@chatofy/types';
import { Button, SegmentedControl } from '@chatofy/ui/react';
import { useLocale, useTranslate } from '@/i18n/provider';
import { formatCredits } from '@/lib/credit-format';
import { formatUsd, formatVnd } from '@/lib/pricing-content';
import { CreditBillingGroup } from './credit-billing-group';
import { canBuyOn, checkoutKey, type UseCreditCheckout } from './use-credit-checkout';

const RAILS = ['polar', 'sepay'] as const satisfies readonly PaymentRail[];

/**
 * The "Buy credits" group: top-up packs, which never expire.
 *
 * **The payment method is chosen once**, in a segmented control above the packs,
 * rather than repeated as a card row and a VietQR row per pack. A method whose rail
 * this deployment reports unavailable (its secrets are missing) is a disabled
 * segment; with no method left the group is not drawn at all. A Vietnamese reader
 * starts on VietQR and everyone else on card, when that rail is there.
 *
 * **Each pack is a tile**: the credits large, the price on the chosen method, and an
 * outline Buy. None is filled — on a Free account with checkout open the tab's one
 * accent is Upgrade, and a Pro account has nothing here that outranks the rest. A
 * closed account sees every Buy disabled and described by the tab's closed line.
 *
 * Three across from `sm`; on a phone each tile is a row, amount left and Buy right.
 */
export function CreditTopupPacks({
  balance,
  plans,
  checkout,
  closed,
  closedId,
  after,
}: {
  balance: CreditBalance;
  plans: Plan[];
  checkout: UseCreditCheckout;
  closed: boolean;
  closedId: string;
  /** The open QR panel for a top-up, so paying stays beside buying. */
  after?: React.ReactNode;
}) {
  const t = useTranslate();
  const locale = useLocale();
  const baseId = useId();
  const packs = plans.filter((plan) => plan.kind === 'topup').sort((a, b) => a.credits - b.credits);
  const usable = RAILS.filter((rail) => packs.some((pack) => canBuyOn(pack, rail, balance)));
  const preferred: PaymentRail = locale === 'vi' ? 'sepay' : 'polar';
  const [chosen, setChosen] = useState<PaymentRail>(preferred);

  if (usable.length === 0) return null;
  const rail = usable.includes(chosen) ? chosen : usable[0]!;
  const shown = packs.filter((pack) => canBuyOn(pack, rail, balance));

  return (
    <CreditBillingGroup
      data-credit-topups
      title={t('web.account.buyTitle')}
      note={t('web.pricing.topupsSummary')}
    >
      <div className="flex flex-col gap-4">
        <SegmentedControl
          label={t('web.billing.payWith')}
          value={rail}
          options={RAILS.map((value) => ({
            value,
            label: t(value === 'polar' ? 'web.billing.methodCard' : 'web.billing.methodQr'),
            disabled: !usable.includes(value),
          }))}
          onChange={setChosen}
        />
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3" data-credit-topup-list>
          {shown.map((pack) => {
            const key = checkoutKey({ planCode: pack.code, rail });
            const buttonId = `${baseId}-${key}`;
            const offerId = `${buttonId}-offer`;
            const credits = formatCredits(t, locale, pack.credits);
            const price =
              rail === 'polar'
                ? formatUsd(pack.priceUsdCents ?? 0, locale)
                : formatVnd(pack.priceVnd ?? 0, locale);
            return (
              <li
                key={key}
                data-topup-pack={pack.code}
                className="border-hairline flex items-center justify-between gap-4 rounded-md border p-4 sm:flex-col sm:items-stretch"
              >
                <div className="flex flex-col gap-1">
                  <span className="text-heading font-display leading-tight font-light tabular-nums">
                    {credits}
                  </span>
                  <span className="text-prose text-body tabular-nums">{price}</span>
                </div>
                {/* The whole offer, for the button's accessible name; the tile shows
                    it as two lines a screen reader would otherwise read apart. */}
                <span id={offerId} className="sr-only">
                  {t(rail === 'polar' ? 'web.account.buyTopupCard' : 'web.account.buyTopupQr', {
                    credits,
                    price,
                  })}
                </span>
                <Button
                  id={buttonId}
                  variant="outline"
                  size="sm"
                  disabled={closed || checkout.pending !== null}
                  aria-labelledby={`${buttonId} ${offerId}`}
                  aria-describedby={closed ? closedId : undefined}
                  onClick={() => void checkout.start({ planCode: pack.code, rail })}
                >
                  {checkout.pending === key
                    ? t('web.account.checkoutOpening')
                    : t('web.account.buy')}
                </Button>
              </li>
            );
          })}
        </ul>
      </div>
      {after}
    </CreditBillingGroup>
  );
}
