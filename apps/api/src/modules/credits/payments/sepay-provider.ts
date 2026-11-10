import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CheckoutResponse, RailStatus } from '@chatofy/types';
import type { Env } from '../../../config/env.schema';
import { PrismaService } from '../../../prisma/prisma.service';
import type { PlanRow } from '../plan-catalog';
import {
  PaymentProviderError,
  type CheckoutUser,
  type PaymentProvider,
} from './payment-provider';
import { railStatus, readBillingEnv, type BillingEnv } from './rail-status';

/** How long a QR is shown as payable. A matching transfer after it still grants. */
export const SEPAY_ORDER_TTL_MS = 30 * 60_000;

/** RFC 4648 base32: upper case and digits a bank memo keeps intact. */
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
/** Characters after the prefix: 8 × 5 bits = 40 random bits. */
export const ORDER_CODE_SUFFIX_LENGTH = 8;

/** A fresh, unguessable order code: the prefix plus 40 random bits. */
export function newOrderCode(prefix: string): string {
  const bytes = randomBytes(5);
  let bits = 0n;
  for (const byte of bytes) bits = (bits << 8n) | BigInt(byte);
  let suffix = '';
  for (let i = ORDER_CODE_SUFFIX_LENGTH - 1; i >= 0; i--) {
    suffix += BASE32[Number((bits >> BigInt(i * 5)) & 31n)];
  }
  return `${prefix}${suffix}`;
}

/** Matches an order code inside free memo text, whatever the bank did to its case. */
export function orderCodePattern(prefix: string): RegExp {
  return new RegExp(`${prefix}[A-Z2-7]{${ORDER_CODE_SUFFIX_LENGTH}}`, 'i');
}

/**
 * SePay: a VietQR bank transfer carrying an order code in its memo.
 *
 * The order row is the whole checkout — SePay has no checkout API for a plain
 * transfer. Its webhook later finds the order by the code and checks the amount.
 */
@Injectable()
export class SepayProvider implements PaymentProvider {
  readonly rail = 'sepay' as const;
  private readonly env: BillingEnv;

  constructor(
    config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
  ) {
    this.env = readBillingEnv(config);
  }

  status(): RailStatus {
    return railStatus(this.env, 'sepay');
  }

  get orderPrefix(): string {
    return this.env.SEPAY_ORDER_PREFIX;
  }

  offers(plan: PlanRow): boolean {
    return (
      plan.active &&
      plan.sepay &&
      plan.priceVnd !== null &&
      plan.priceVnd > 0 &&
      this.status() !== 'unavailable'
    );
  }

  async createCheckout(
    user: CheckoutUser,
    plan: PlanRow,
  ): Promise<CheckoutResponse> {
    const amountVnd = plan.priceVnd;
    if (!amountVnd)
      throw new PaymentProviderError(`${plan.code} has no VND price`);
    const expiresAt = new Date(Date.now() + SEPAY_ORDER_TTL_MS);
    // 40 random bits make a collision vanishingly rare, but the column is
    // unique, so one is retried rather than surfaced as a 500.
    for (let attempt = 0; attempt < 3; attempt++) {
      const orderCode = newOrderCode(this.orderPrefix);
      const created = await this.prisma.paymentOrder.createManyAndReturn({
        data: [
          {
            userId: user.id,
            provider: 'sepay',
            planCode: plan.code,
            amountMinor: amountVnd,
            currency: 'VND',
            amountVnd,
            orderCode,
            status: 'pending',
            expiresAt,
          },
        ],
        skipDuplicates: true,
        select: { id: true },
      });
      const orderId = created[0]?.id;
      if (!orderId) continue;
      return {
        rail: 'sepay',
        orderId,
        orderCode,
        amountVnd,
        qrUrl: this.qrUrl(amountVnd, orderCode),
        expiresAt: expiresAt.toISOString(),
      };
    }
    throw new PaymentProviderError('could not allocate a unique order code');
  }

  /** SePay's VietQR image for an exact amount and memo. */
  private qrUrl(amountVnd: number, orderCode: string): string {
    const params = new URLSearchParams({
      acc: this.env.SEPAY_BANK_ACCOUNT ?? '',
      bank: this.env.SEPAY_BANK ?? '',
      amount: String(amountVnd),
      des: orderCode,
      template: 'compact',
    });
    return `https://vietqr.app/img?${params.toString()}`;
  }
}
