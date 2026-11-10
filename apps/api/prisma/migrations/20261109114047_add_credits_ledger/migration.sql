-- CreateTable
CREATE TABLE "Plan" (
    "code" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "priceUsdCents" INTEGER,
    "priceVnd" INTEGER,
    "periodDays" INTEGER,
    "polar" BOOLEAN NOT NULL DEFAULT false,
    "sepay" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "CreditGrant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "planCode" TEXT,
    "amount" INTEGER NOT NULL,
    "remaining" INTEGER NOT NULL,
    "startsAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "costBasis" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "externalRef" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditLease" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "held" INTEGER NOT NULL DEFAULT 0,
    "consumed" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "CreditLease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "grantId" TEXT,
    "leaseId" TEXT,
    "kind" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "sessionId" TEXT,
    "conversationId" TEXT,
    "reason" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "providerUpdatedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentOrder" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "provider" TEXT NOT NULL,
    "planCode" TEXT,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "amountVnd" INTEGER,
    "paidAmountVnd" INTEGER,
    "orderCode" TEXT,
    "externalRef" TEXT,
    "status" TEXT NOT NULL,
    "reviewReason" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolvedNote" TEXT,

    CONSTRAINT "PaymentOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcome" TEXT NOT NULL,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CreditGrant_externalRef_key" ON "CreditGrant"("externalRef");

-- CreateIndex
CREATE INDEX "CreditGrant_userId_status_expiresAt_idx" ON "CreditGrant"("userId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "CreditLease_status_expiresAt_idx" ON "CreditLease"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "CreditLease_userId_idx" ON "CreditLease"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditEntry_idempotencyKey_key" ON "CreditEntry"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CreditEntry_userId_createdAt_idx" ON "CreditEntry"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "CreditEntry_sessionId_idx" ON "CreditEntry"("sessionId");

-- CreateIndex
CREATE INDEX "CreditEntry_leaseId_idx" ON "CreditEntry"("leaseId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_externalId_key" ON "Subscription"("externalId");

-- CreateIndex
CREATE INDEX "Subscription_userId_idx" ON "Subscription"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentOrder_orderCode_key" ON "PaymentOrder"("orderCode");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentOrder_externalRef_key" ON "PaymentOrder"("externalRef");

-- CreateIndex
CREATE INDEX "PaymentOrder_status_expiresAt_idx" ON "PaymentOrder"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "PaymentOrder_userId_idx" ON "PaymentOrder"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_provider_eventId_key" ON "WebhookEvent"("provider", "eventId");


-- A grant's spendable amount can never go negative. The ledger's allocation
-- already takes at most what a grant holds; this makes a bug in it abort the
-- transaction instead of writing a negative balance.
ALTER TABLE "CreditGrant" ADD CONSTRAINT "CreditGrant_remaining_nonnegative" CHECK ("remaining" >= 0);

-- The plan catalogue. Credits are whole credits (1 credit = 1 caption-minute);
-- USD in cents, VND in whole đồng. Free resets on the calendar month and a
-- top-up never expires, so neither has a period length.
INSERT INTO "Plan" ("code", "kind", "credits", "priceUsdCents", "priceVnd", "periodDays", "polar", "sepay", "active", "sortOrder") VALUES
  ('free',         'free',         120,  NULL, NULL,   NULL, false, false, true, 0),
  ('pro_monthly',  'subscription', 600,  999,  NULL,   30,   true,  false, true, 10),
  ('pro_pass_30d', 'pass',         600,  NULL, 249000, 30,   false, true,  true, 20),
  ('topup_250',    'topup',        250,  500,  125000, NULL, true,  true,  true, 30),
  ('topup_550',    'topup',        550,  1000, 250000, NULL, true,  true,  true, 40),
  ('topup_1500',   'topup',        1500, 2500, 625000, NULL, true,  true,  true, 50);
