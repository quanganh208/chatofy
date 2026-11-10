import {
  Controller,
  ForbiddenException,
  HttpCode,
  Logger,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../../../common/decorators/public.decorator';
import type { Env } from '../../../config/env.schema';
import { verifyStandardWebhook } from './polar-webhook-signature';
import { PolarWebhookHandler } from './polar-webhook.handler';
import { verifySepayHmac } from './sepay-webhook-signature';
import { SepayWebhookHandler } from './sepay-webhook.handler';

/** The body SePay requires, byte for byte, before it stops retrying. */
export const SEPAY_SUCCESS_BODY = { success: true } as const;

/**
 * The payment rails' signed callbacks.
 *
 * `@Public` because the caller is the provider, not a user, and every request
 * is refused before touching the database unless its signature verifies over
 * the RAW body (`registerNarrowBodyLimits` mounts a raw parser on this path, so
 * the bytes are never re-serialised JSON). Replies are left unwrapped by
 * `TransformInterceptor`: SePay accepts only the exact body `{"success":true}`.
 *
 * After a delivery verifies, it is acknowledged unless the database failed —
 * a mismatch that retrying cannot fix is recorded and answered 2xx, so neither
 * provider retries it forever (Polar disables an endpoint after 10 failures).
 * Not in the API docs: these are provider contracts, not client routes.
 */
@ApiExcludeController()
@Controller('billing/webhooks')
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 300, ttl: 60_000 } })
export class BillingWebhooksController {
  private readonly logger = new Logger(BillingWebhooksController.name);
  private readonly polarSecret: string | undefined;
  private readonly sepaySecret: string | undefined;

  constructor(
    config: ConfigService<Env, true>,
    private readonly polar: PolarWebhookHandler,
    private readonly sepay: SepayWebhookHandler,
  ) {
    this.polarSecret = config.get('POLAR_WEBHOOK_SECRET', { infer: true });
    this.sepaySecret = config.get('SEPAY_WEBHOOK_SECRET', { infer: true });
  }

  @Post('polar')
  @Public()
  @HttpCode(202)
  async polarWebhook(@Req() req: Request): Promise<void> {
    const raw: unknown = req.body;
    if (
      !this.polarSecret ||
      !Buffer.isBuffer(raw) ||
      !verifyStandardWebhook(raw, req.headers, this.polarSecret)
    ) {
      throw new ForbiddenException('Invalid webhook signature');
    }
    const webhookId = String(req.headers['webhook-id']);
    const result = await this.polar.receive(webhookId, raw);
    this.logger.log(
      `polar webhook ${webhookId}: ${result.duplicate ? 'duplicate' : result.outcome}`,
    );
  }

  @Post('sepay')
  @Public()
  @HttpCode(200)
  async sepayWebhook(@Req() req: Request): Promise<typeof SEPAY_SUCCESS_BODY> {
    const raw: unknown = req.body;
    if (
      !this.sepaySecret ||
      !Buffer.isBuffer(raw) ||
      !verifySepayHmac(raw, req.headers, this.sepaySecret)
    ) {
      throw new UnauthorizedException('Invalid webhook signature');
    }
    const result = await this.sepay.receive(raw);
    this.logger.log(
      `sepay webhook: ${result.duplicate ? 'duplicate' : result.outcome}`,
    );
    return SEPAY_SUCCESS_BODY;
  }
}
