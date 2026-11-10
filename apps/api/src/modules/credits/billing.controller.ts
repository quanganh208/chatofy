import {
  Controller,
  Get,
  Inject,
  Query,
  Req,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import {
  creditsFromSeconds,
  planListResponseSchema,
  type CreditBalance,
  type CreditUsageListResponse,
  type PaymentRail,
  type PlanListResponse,
} from '@chatofy/types';
import { Public } from '../../common/decorators/public.decorator';
import { ApiEnvelopeResponse } from '../../common/swagger/api-envelope-response.helper';
import { ApiErrorResponses } from '../../common/swagger/api-error-response.helper';
import {
  CreditBalanceDto,
  CreditUsageListResponseDto,
  CreditUsageQueryDto,
  PlanListResponseDto,
} from './billing.dto';
import {
  CREDIT_LEDGER,
  LedgerUnavailableError,
  type CreditLedgerPort,
} from './credit-ledger.port';
import { CreditUsageReader } from './credit-usage.reader';
import { CheckoutAllowlist } from './payments/checkout-allowlist';
import type { PaymentProvider } from './payments/payment-provider';
import { PolarProvider } from './payments/polar-provider';
import { SepayProvider } from './payments/sepay-provider';
import { PlanCatalog } from './plan-catalog';

/**
 * Credits and plans.
 *
 * `ThrottlerGuard` is mounted here because there is no global throttle; the
 * module default (60/min) covers `me` and `usage`. The user is always the
 * verified token's subject, never a parameter.
 */
@ApiTags('billing')
@Controller('billing')
@UseGuards(ThrottlerGuard)
export class BillingController {
  private readonly rails: Record<PaymentRail, PaymentProvider>;

  constructor(
    @Inject(CREDIT_LEDGER) private readonly ledger: CreditLedgerPort,
    private readonly plans: PlanCatalog,
    private readonly usage: CreditUsageReader,
    private readonly allowlist: CheckoutAllowlist,
    polar: PolarProvider,
    sepay: SepayProvider,
  ) {
    this.rails = { polar, sepay };
  }

  @Get('plans')
  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({
    summary: 'List the plans and top-up packs',
    description:
      'Public: prices only. `rails` lists where each plan can be bought right now; a rail this deployment has not opened is left out.',
  })
  @ApiEnvelopeResponse(PlanListResponseDto)
  @ApiErrorResponses(429)
  async listPlans(): Promise<PlanListResponse> {
    const plans = await this.plans.active();
    // Parsed on the way out: the rows are data a migration wrote, and a wrong
    // `kind` there should fail here rather than in every client.
    return planListResponseSchema.parse({
      plans: plans.map((plan) => ({
        code: plan.code,
        kind: plan.kind,
        credits: plan.credits,
        priceUsdCents: plan.priceUsdCents,
        priceVnd: plan.priceVnd,
        periodDays: plan.periodDays,
        rails: (['polar', 'sepay'] as const).filter((rail) =>
          this.rails[rail].offers(plan),
        ),
      })),
    });
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({
    summary: "The caller's credit balance and plan",
    description:
      'Credits held by an open translation are counted as the caller’s, so an idle connection does not look like spending. The Free allowance for the month is written on first read.',
  })
  @ApiEnvelopeResponse(CreditBalanceDto)
  @ApiErrorResponses(401, 429, 503)
  async me(@Req() req: Request): Promise<CreditBalance> {
    const userId = req.auth!.userId;
    const [balance, checkoutAllowed] = await Promise.all([
      this.withLedger(() => this.ledger.balance(userId)),
      this.allowlist.allowsUser(userId),
    ]);
    return {
      totalCredits: creditsFromSeconds(
        balance.planSeconds + balance.topupSeconds,
      ),
      planCredits: creditsFromSeconds(balance.planSeconds),
      topupCredits: creditsFromSeconds(balance.topupSeconds),
      planResetsAt: balance.planResetsAt?.toISOString() ?? null,
      plan: balance.plan,
      proSource:
        balance.proSource === 'subscription'
          ? 'polar'
          : balance.proSource === 'pass'
            ? 'sepay'
            : null,
      checkoutAllowed,
      rails: {
        polar: this.rails.polar.status(),
        sepay: this.rails.sepay.status(),
      },
    };
  }

  @Get('usage')
  @ApiBearerAuth()
  @ApiOperation({
    summary: "The caller's credit usage history",
    description:
      'Newest first, cursor-paged: pass `nextCursor` back as `?cursor=`. Translation is one row per conversation per day when the client named the conversation, otherwise one row per connection.',
  })
  @ApiEnvelopeResponse(CreditUsageListResponseDto)
  @ApiErrorResponses(400, 401, 429)
  usageHistory(
    @Req() req: Request,
    @Query() query: CreditUsageQueryDto,
  ): Promise<CreditUsageListResponse> {
    return this.usage.page(req.auth!.userId, query.cursor);
  }

  private async withLedger<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof LedgerUnavailableError) {
        throw new ServiceUnavailableException(
          'Credits could not be read right now',
        );
      }
      throw err;
    }
  }
}
