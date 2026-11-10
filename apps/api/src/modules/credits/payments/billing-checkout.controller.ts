import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Logger,
  NotFoundException,
  Param,
  Post,
  Req,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import type {
  BillingPortalResponse,
  CheckoutOrder,
  CheckoutResponse,
  PaymentRail,
} from '@chatofy/types';
import { CodedHttpException } from '../../../common/exceptions/coded-http.exception';
import { ApiEnvelopeResponse } from '../../../common/swagger/api-envelope-response.helper';
import { ApiErrorResponses } from '../../../common/swagger/api-error-response.helper';
import { PrismaService } from '../../../prisma/prisma.service';
import { UserThrottlerGuard } from '../../auth/user-throttler.guard';
import {
  BillingPortalResponseDto,
  CheckoutResponseDto,
  CreateCheckoutDto,
  PaymentOrderIdParamDto,
  PaymentOrderStatusResponseDto,
} from '../billing.dto';
import { PlanCatalog } from '../plan-catalog';
import { CheckoutAllowlist } from './checkout-allowlist';
import { PaymentProviderError, type PaymentProvider } from './payment-provider';
import { PolarProvider } from './polar-provider';
import { SepayProvider } from './sepay-provider';

/**
 * Starting a purchase, and following one.
 *
 * Checkout is open only to allowlisted accounts: the refusal is
 * `CHECKOUT_NOT_OPEN`, not `FORBIDDEN`, so a client explains it instead of
 * treating it as a permissions fault. Throttled per account (there is no global
 * throttle), since every route here is authenticated.
 */
@ApiTags('billing')
@ApiBearerAuth()
@Controller('billing')
@UseGuards(UserThrottlerGuard)
export class BillingCheckoutController {
  private readonly logger = new Logger(BillingCheckoutController.name);
  private readonly rails: Record<PaymentRail, PaymentProvider>;

  constructor(
    private readonly plans: PlanCatalog,
    private readonly allowlist: CheckoutAllowlist,
    private readonly polar: PolarProvider,
    sepay: SepayProvider,
    private readonly prisma: PrismaService,
  ) {
    this.rails = { polar, sepay };
  }

  @Post('checkout')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Start buying a plan or top-up',
    description:
      'Polar answers a hosted checkout `url`; SePay answers a VietQR for an exact amount and memo code. Nothing is granted here: credits arrive when the rail confirms payment. 403 carries `CHECKOUT_NOT_OPEN` for an account that is not let in to checkout. 400 when the rail is unavailable on this deployment or does not sell the plan. 10 per minute per account.',
  })
  @ApiEnvelopeResponse(CheckoutResponseDto)
  @ApiErrorResponses(400, 401, 403, 429, 503)
  async checkout(
    @Req() req: Request,
    @Body() body: CreateCheckoutDto,
  ): Promise<CheckoutResponse> {
    const userId = req.auth!.userId;
    const email = await this.allowlist.emailOf(userId);
    if (!email || !this.allowlist.allowsEmail(email)) {
      throw new CodedHttpException(
        'CHECKOUT_NOT_OPEN',
        403,
        'Checkout is not open to this account yet',
      );
    }
    const provider = this.rails[body.rail];
    const plan = await this.plans.get(body.planCode);
    if (provider.status() === 'unavailable') {
      throw new BadRequestException(`${body.rail} is not available right now`);
    }
    if (!plan || !provider.offers(plan)) {
      throw new BadRequestException(
        `${body.planCode} cannot be bought with ${body.rail}`,
      );
    }
    try {
      return await provider.createCheckout({ id: userId, email }, plan);
    } catch (err) {
      throw this.providerFailure(err, `checkout ${body.rail} ${plan.code}`);
    }
  }

  @Get('orders/:id')
  @ApiOperation({
    summary: 'The status of one of your payment orders',
    description:
      'Polled while a SePay QR is shown: `pending` until a transfer arrives, then `paid` (or `needs_review` when it did not match). Another account’s order is 404.',
  })
  @ApiEnvelopeResponse(PaymentOrderStatusResponseDto)
  @ApiErrorResponses(400, 401, 404, 429)
  async order(
    @Req() req: Request,
    @Param() params: PaymentOrderIdParamDto,
  ): Promise<CheckoutOrder> {
    const order = await this.prisma.paymentOrder.findFirst({
      where: { id: params.id, userId: req.auth!.userId },
    });
    if (!order) throw new NotFoundException('No such order');
    return {
      id: order.id,
      status: order.status as CheckoutOrder['status'],
      planCode: order.planCode,
      amountVnd: order.amountVnd,
      expiresAt: order.expiresAt.toISOString(),
      paidAt: order.paidAt?.toISOString() ?? null,
    };
  }

  @Get('portal')
  @ApiOperation({
    summary: 'A link to manage your Polar subscription',
    description:
      'A short-lived Polar customer-portal URL, where the subscription is cancelled (it then ends at the period end and no further credits are granted). Create one per click; do not store it. 404 when this account has never bought on Polar.',
  })
  @ApiEnvelopeResponse(BillingPortalResponseDto)
  @ApiErrorResponses(400, 401, 404, 429, 503)
  async portal(@Req() req: Request): Promise<BillingPortalResponse> {
    if (this.polar.status() === 'unavailable') {
      throw new BadRequestException('polar is not available right now');
    }
    try {
      return { url: await this.polar.createPortalUrl(req.auth!.userId) };
    } catch (err) {
      throw this.providerFailure(err, 'portal');
    }
  }

  /** A provider refusal or outage, as the client should see it. */
  private providerFailure(err: unknown, what: string): Error {
    if (!(err instanceof PaymentProviderError)) return err as Error;
    this.logger.warn(`${what} failed: ${err.message}`);
    if (err.notFound) return new NotFoundException('No payment account found');
    return new ServiceUnavailableException(
      'The payment provider could not be reached; try again shortly',
    );
  }
}
