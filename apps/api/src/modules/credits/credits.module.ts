import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { CREDIT_LEDGER, type CreditLedgerPort } from './credit-ledger.port';
import { CreditLeaseReaper } from './credit-lease-reaper';
import { CreditLeases } from './credit-leases.service';
import { CreditOwnerTools } from './credit-owner-tools.service';
import { CreditUsageReader } from './credit-usage.reader';
import { CreditsLedger } from './credits-ledger.service';
import { BillingCheckoutController } from './payments/billing-checkout.controller';
import { BillingWebhooksController } from './payments/billing-webhooks.controller';
import { CheckoutAllowlist } from './payments/checkout-allowlist';
import { PolarProvider } from './payments/polar-provider';
import { PolarWebhookHandler } from './payments/polar-webhook.handler';
import { SepayProvider } from './payments/sepay-provider';
import { SepayWebhookHandler } from './payments/sepay-webhook.handler';
import { WebhookInbox } from './payments/webhook-inbox';
import { PlanCatalog } from './plan-catalog';

/**
 * The port bound to the Prisma ledger and leases. Explicit method by method, so
 * the port is all a consumer can reach — the owner's void and review tools live
 * on `CreditOwnerTools`, used by the reaper and the CLI.
 */
function prismaCreditLedger(
  ledger: CreditsLedger,
  leases: CreditLeases,
): CreditLedgerPort {
  return {
    balance: (userId) => ledger.balance(userId),
    grant: (input, tx) => ledger.grant(input, tx),
    debit: (input) => ledger.debit(input),
    refund: (input) => ledger.refund(input),
    openLease: (userId, want) => leases.open(userId, want),
    extendLease: (leaseId, want) => leases.extend(leaseId, want),
    settleLease: (input) => leases.settle(input),
    closeLease: (leaseId) => leases.close(leaseId),
  };
}

/**
 * Credits: the ledger, leases, the plan catalogue, the reaper, the billing
 * read endpoints, and the payment rails (Polar, SePay) with their webhooks. Consumers inject `CREDIT_LEDGER`; the fast e2e suites
 * override that token with the in-memory ledger.
 */
@Module({
  controllers: [
    BillingController,
    BillingCheckoutController,
    BillingWebhooksController,
  ],
  providers: [
    CheckoutAllowlist,
    PolarProvider,
    SepayProvider,
    WebhookInbox,
    PolarWebhookHandler,
    SepayWebhookHandler,
    PlanCatalog,
    CreditsLedger,
    CreditLeases,
    CreditOwnerTools,
    CreditUsageReader,
    CreditLeaseReaper,
    {
      provide: CREDIT_LEDGER,
      useFactory: prismaCreditLedger,
      inject: [CreditsLedger, CreditLeases],
    },
  ],
  exports: [CREDIT_LEDGER, PlanCatalog],
})
export class CreditsModule {}
