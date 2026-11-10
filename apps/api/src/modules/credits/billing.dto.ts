import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  billingPortalResponseSchema,
  checkoutOrderSchema,
  checkoutResponseSchema,
  createCheckoutRequestSchema,
  creditBalanceSchema,
  paymentRailSchema,
  creditUsageListResponseSchema,
  planListResponseSchema,
} from '@chatofy/types';

/** GET /billing/usage query: the opaque keyset cursor a previous page returned. */
const creditUsageQuerySchema = z.object({
  cursor: z.string().min(1).max(512).optional(),
});

export class CreditUsageQueryDto extends createZodDto(creditUsageQuerySchema) {}
export class PlanListResponseDto extends createZodDto(planListResponseSchema) {}
export class CreditBalanceDto extends createZodDto(creditBalanceSchema) {}
export class CreditUsageListResponseDto extends createZodDto(
  creditUsageListResponseSchema,
) {}

export class CreateCheckoutDto extends createZodDto(
  createCheckoutRequestSchema,
) {}
/**
 * Documentation shape for the checkout reply. The wire contract is the
 * discriminated union `checkoutResponseSchema`, which a DTO class cannot
 * extend, so the docs show its two arms flattened: `url` on Polar, the order
 * fields on SePay.
 */
const [polarCheckoutArm, sepayCheckoutArm] = checkoutResponseSchema.options;
const checkoutResponseDocSchema = sepayCheckoutArm.partial().extend({
  rail: paymentRailSchema,
  url: polarCheckoutArm.shape.url.optional(),
});
export class CheckoutResponseDto extends createZodDto(
  checkoutResponseDocSchema,
) {}

/** GET /billing/orders/:id — the id `POST /billing/checkout` returned. */
const paymentOrderIdParamSchema = z.object({ id: z.string().min(1).max(64) });
export class PaymentOrderIdParamDto extends createZodDto(
  paymentOrderIdParamSchema,
) {}

export class PaymentOrderStatusResponseDto extends createZodDto(
  checkoutOrderSchema,
) {}

/** GET /billing/portal — a short-lived Polar customer-portal link. */
export class BillingPortalResponseDto extends createZodDto(
  billingPortalResponseSchema,
) {}
