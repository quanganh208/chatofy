import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
// The payment rails against a REAL Postgres, through the real routes.
//
// Every webhook here is a fixture signed with a test secret by the algorithm
// each provider documents (test/utils/payment-webhook-signing.ts) and posted to
// `/billing/webhooks/{polar,sepay}` exactly as the provider would: raw JSON
// bytes, the provider's headers. What only this suite proves: the dedup row
// and the grant commit or roll back together, out-of-order Polar deliveries
// never cut a newer period short, and SePay sees the exact bytes it requires.
import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { WsAdapter } from '@nestjs/platform-ws';
import request from 'supertest';
import {
  CREDIT_SECONDS_PER_CREDIT,
  checkoutResponseSchema,
  creditBalanceSchema,
} from '@chatofy/types';
import { z } from 'zod';
import { AppModule } from '../src/app.module';
import { registerNarrowBodyLimits } from '../src/common/middleware/narrow-body-limits';
import { requestIdMiddleware } from '../src/common/middleware/request-id.middleware';
import { CreditOwnerTools } from '../src/modules/credits/credit-owner-tools.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { registerAndLogin, type Identity } from './utils/auth-fixture';
import {
  newPolarSecret,
  polarHeaders,
  sepayHeaders,
} from './utils/payment-webhook-signing';
import { errorBody, successBody } from './utils/response-body';

// The billing env is read when AppModule is imported, so it is set before any
// import runs. Only the two allowlisted addresses may buy.
const env = vi.hoisted(() => {
  const run = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const polarSecret = `whsec_${Buffer.from(`polar-${run}-0123456789abcdef`).toString('base64')}`;
  const sepaySecret = `sepay-${run}`;
  const allowed = [
    `buyer-${run}@db-e2e.example.com`,
    `buyer2-${run}@db-e2e.example.com`,
  ];
  Object.assign(process.env, {
    BILLING_CHECKOUT_ALLOWLIST: allowed
      .map((e) => ` ${e.toUpperCase()} `)
      .join(','),
    POLAR_ACCESS_TOKEN: 'polar_oat_db_e2e_not_used',
    POLAR_WEBHOOK_SECRET: polarSecret,
    POLAR_PRODUCT_IDS: 'pro_monthly=prod_pro,topup_250=prod_t250',
    SEPAY_WEBHOOK_SECRET: sepaySecret,
    SEPAY_BANK_ACCOUNT: '0123456789',
    SEPAY_BANK: 'MBBank',
  });
  return { run, polarSecret, sepaySecret, allowed };
});

const { run } = env;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const credits = (n: number) => n * CREDIT_SECONDS_PER_CREDIT;
let txSeq = Math.floor(Math.random() * 1e6) * 1000;

describe('billing webhooks and checkout (db-e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let admin: CreditOwnerTools;
  let buyer: Identity;
  let buyer2: Identity;
  let outsider: Identity;
  const users: string[] = [];
  /** Every delivery id this run posted, so cleanup touches nothing else. */
  const posted = { polar: new Set<string>(), sepay: new Set<string>() };

  const http = () => request(app.getHttpServer());
  const grants = (userId: string) =>
    prisma.creditGrant.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
  const events = (eventId: string) =>
    prisma.webhookEvent.findMany({ where: { eventId } });

  /** Posts a Polar event: raw JSON bytes, signed with the endpoint secret. */
  function postPolar(
    payload: unknown,
    options: { id?: string; secret?: string } = {},
  ) {
    const body = JSON.stringify(payload);
    const id = options.id ?? `evt_${run}_${posted.polar.size}`;
    posted.polar.add(id);
    return http()
      .post('/billing/webhooks/polar')
      .set('content-type', 'application/json')
      .set(polarHeaders(body, options.secret ?? env.polarSecret, { id }))
      .send(body);
  }

  /** Posts a SePay transfer; the reply text is captured as-is. */
  function postSepay(payload: { id: number }, secret = env.sepaySecret) {
    posted.sepay.add(String(payload.id));
    const body = JSON.stringify(payload);
    return http()
      .post('/billing/webhooks/sepay')
      .set('content-type', 'application/json')
      .set(sepayHeaders(body, secret))
      .send(body)
      .buffer(true)
      .parse((res, done) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (text += chunk));
        res.on('end', () => done(null, text));
      });
  }

  /** An `order.paid` as Polar's 2026-04 `Order`, embedded subscription included. */
  function orderPaid(o: {
    id: string;
    userId: string;
    reason: 'purchase' | 'subscription_create' | 'subscription_cycle';
    productId?: string;
    period?: [Date, Date];
    externalId?: string | null;
    /** Replaces the checkout metadata; null sends none, as a renewal may. */
    metadata?: Record<string, unknown> | null;
  }) {
    return {
      type: 'order.paid',
      timestamp: new Date().toISOString(),
      data: {
        id: o.id,
        created_at: new Date().toISOString(),
        modified_at: new Date().toISOString(),
        status: 'paid',
        paid: true,
        billing_reason: o.reason,
        subtotal_amount: o.reason === 'purchase' ? 500 : 999,
        net_amount: o.reason === 'purchase' ? 500 : 999,
        tax_amount: 0,
        total_amount: o.reason === 'purchase' ? 500 : 999,
        currency: 'usd',
        customer_id: `cus_${o.userId}`,
        customer: {
          id: `cus_${o.userId}`,
          external_id: o.externalId === undefined ? o.userId : o.externalId,
        },
        product_id:
          o.productId ?? (o.reason === 'purchase' ? 'prod_t250' : 'prod_pro'),
        subscription_id: o.period ? `sub_${o.userId}` : null,
        subscription: o.period
          ? {
              id: `sub_${o.userId}`,
              status: 'active',
              current_period_start: o.period[0].toISOString(),
              current_period_end: o.period[1].toISOString(),
              cancel_at_period_end: false,
            }
          : null,
        metadata:
          o.metadata !== undefined
            ? o.metadata
            : {
                userId: o.userId,
                planCode: o.reason === 'purchase' ? 'topup_250' : 'pro_monthly',
              },
        items: [],
      },
    };
  }

  function subscriptionEvent(
    type: string,
    s: {
      userId: string;
      status: string;
      modifiedAt: Date;
      cancelAtPeriodEnd?: boolean;
    },
  ) {
    return {
      type,
      timestamp: new Date().toISOString(),
      data: {
        id: `sub_${s.userId}`,
        status: s.status,
        created_at: new Date(Date.now() - DAY).toISOString(),
        modified_at: s.modifiedAt.toISOString(),
        current_period_start: new Date().toISOString(),
        current_period_end: new Date(Date.now() + 30 * DAY).toISOString(),
        cancel_at_period_end: s.cancelAtPeriodEnd ?? false,
        customer: { id: `cus_${s.userId}`, external_id: s.userId },
        metadata: { userId: s.userId },
      },
    };
  }

  function transfer(code: string | null, amount: number, content?: string) {
    return {
      id: ++txSeq,
      gateway: 'MBBank',
      transactionDate: '2026-11-09 19:00:00',
      accountNumber: '0123456789',
      subAccount: '',
      code,
      content: content ?? `${code ?? 'no code'} chuyen tien`,
      transferType: 'in',
      description: '',
      transferAmount: amount,
      accumulated: 0,
      referenceCode: `FT${txSeq}`,
    };
  }

  async function sepayOrder(who: Identity, planCode: string) {
    const res = await http()
      .post('/billing/checkout')
      .set('Authorization', who.bearer)
      .send({ planCode, rail: 'sepay' });
    expect(res.status).toBe(201);
    const order = successBody(res, checkoutResponseSchema).data;
    if (order.rail !== 'sepay') throw new Error('expected a SePay order');
    return order;
  }

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    app.useWebSocketAdapter(new WsAdapter(app));
    app.use(requestIdMiddleware);
    // The two registrations `bootstrap` performs, in its order: the per-path
    // parsers first (the webhooks need their raw body), then the global JSON
    // parser, which Nest skips installing once any JSON parser is applied.
    registerNarrowBodyLimits(app);
    app.useBodyParser('json', { limit: '12mb' });
    await app.init();
    prisma = app.get(PrismaService);
    admin = app.get(CreditOwnerTools);
    buyer = await registerAndLogin(app, { email: env.allowed[0] });
    buyer2 = await registerAndLogin(app, { email: env.allowed[1] });
    outsider = await registerAndLogin(app, {
      email: `outsider-${run}@db-e2e.example.com`,
    });
    users.push(buyer.userId, buyer2.userId, outsider.userId);
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "CreditGrant" DROP CONSTRAINT IF EXISTS "billing_e2e_refuse"',
    );
    const txRefs = [...posted.sepay].map((id) => `sepay:tx:${id}`);
    await prisma.paymentOrder.deleteMany({
      where: {
        OR: [
          { userId: { in: users } },
          { externalRef: { in: txRefs } },
          { externalRef: { startsWith: 'polar:order:', contains: run } },
        ],
      },
    });
    await prisma.creditEntry.deleteMany({ where: { userId: { in: users } } });
    await prisma.creditGrant.deleteMany({ where: { userId: { in: users } } });
    await prisma.subscription.deleteMany({ where: { userId: { in: users } } });
    for (const provider of ['polar', 'sepay'] as const) {
      await prisma.webhookEvent.deleteMany({
        where: { provider, eventId: { in: [...posted[provider]] } },
      });
    }
    await prisma.user.deleteMany({ where: { email: { contains: run } } });
    await app.close();
  });

  describe('Polar', () => {
    it('a Pro subscription grants 600, and its renewal grants 600 and expires the old remainder', async () => {
      const now = Date.now();
      const p1: [Date, Date] = [new Date(now - DAY), new Date(now + HOUR)];
      const p2: [Date, Date] = [p1[1], new Date(now + HOUR + 30 * DAY)];

      const create = await postPolar(
        orderPaid({
          id: `ord_create_${run}`,
          userId: buyer.userId,
          reason: 'subscription_create',
          period: p1,
        }),
      );
      expect(create.status).toBe(202);
      let rows = await grants(buyer.userId);
      const first = rows.find(
        (g) => g.externalRef === `polar:order:ord_create_${run}`,
      )!;
      expect(first).toMatchObject({
        source: 'subscription',
        amount: credits(600),
        remaining: credits(600),
        status: 'active',
        costBasis: 999,
        currency: 'USD',
      });
      expect(first.startsAt?.toISOString()).toBe(p1[0].toISOString());
      expect(first.expiresAt?.toISOString()).toBe(p1[1].toISOString());

      const cycle = await postPolar(
        orderPaid({
          id: `ord_cycle_${run}`,
          userId: buyer.userId,
          reason: 'subscription_cycle',
          period: p2,
        }),
      );
      expect(cycle.status).toBe(202);
      rows = await grants(buyer.userId);
      const old = rows.find((g) => g.id === first.id)!;
      const renewal = rows.find(
        (g) => g.externalRef === `polar:order:ord_cycle_${run}`,
      )!;
      expect(old).toMatchObject({ status: 'expired', remaining: 0 });
      expect(renewal).toMatchObject({
        status: 'active',
        amount: credits(600),
        remaining: credits(600),
      });
      const expired = await prisma.creditEntry.findUnique({
        where: { idempotencyKey: `expire:${first.id}` },
      });
      expect(expired?.amount).toBe(-credits(600));

      const me = successBody(
        await http().get('/billing/me').set('Authorization', buyer.bearer),
        creditBalanceSchema,
      ).data;
      expect(me).toMatchObject({
        plan: 'pro',
        proSource: 'polar',
        checkoutAllowed: true,
      });
      expect(me.rails).toEqual({ polar: 'sandbox', sepay: 'sandbox' });
    });

    it('a renewal order with no checkout metadata grants by the customer external id', async () => {
      const now = Date.now();
      const id = `evt_bare_cycle_${run}`;
      const res = await postPolar(
        orderPaid({
          id: `ord_bare_cycle_${run}`,
          userId: buyer.userId,
          reason: 'subscription_cycle',
          period: [new Date(now), new Date(now + 30 * DAY)],
          metadata: null,
        }),
        { id },
      );
      expect(res.status).toBe(202);
      expect((await events(id))[0]?.outcome).toBe('granted');
      const grant = (await grants(buyer.userId)).find(
        (g) => g.externalRef === `polar:order:ord_bare_cycle_${run}`,
      );
      expect(grant).toMatchObject({
        source: 'subscription',
        amount: credits(600),
        status: 'active',
      });
    });

    it('an out-of-order delivery (cycle before create) keeps both periods and expires nothing newer', async () => {
      const now = Date.now();
      const p1: [Date, Date] = [new Date(now - DAY), new Date(now + HOUR)];
      const p2: [Date, Date] = [p1[1], new Date(now + HOUR + 30 * DAY)];
      await postPolar(
        orderPaid({
          id: `ord_late_cycle_${run}`,
          userId: buyer2.userId,
          reason: 'subscription_cycle',
          period: p2,
        }),
      );
      const late = await postPolar(
        orderPaid({
          id: `ord_late_create_${run}`,
          userId: buyer2.userId,
          reason: 'subscription_create',
          period: p1,
        }),
      );
      expect(late.status).toBe(202);
      const rows = await grants(buyer2.userId);
      const newer = rows.find(
        (g) => g.externalRef === `polar:order:ord_late_cycle_${run}`,
      );
      const older = rows.find(
        (g) => g.externalRef === `polar:order:ord_late_create_${run}`,
      );
      expect(newer).toMatchObject({
        status: 'active',
        remaining: credits(600),
      });
      expect(older).toMatchObject({
        status: 'active',
        remaining: credits(600),
      });
    });

    it('ignores a subscription event older than the stored one', async () => {
      const t2 = new Date();
      const t1 = new Date(t2.getTime() - 60_000);
      const id = `evt_sub_new_${run}`;
      expect(
        (
          await postPolar(
            subscriptionEvent('subscription.active', {
              userId: buyer.userId,
              status: 'active',
              modifiedAt: t2,
            }),
            { id },
          )
        ).status,
      ).toBe(202);
      const staleId = `evt_sub_old_${run}`;
      expect(
        (
          await postPolar(
            subscriptionEvent('subscription.updated', {
              userId: buyer.userId,
              status: 'past_due',
              modifiedAt: t1,
            }),
            { id: staleId },
          )
        ).status,
      ).toBe(202);
      const row = await prisma.subscription.findUnique({
        where: { externalId: `sub_${buyer.userId}` },
      });
      expect(row).toMatchObject({
        status: 'active',
        provider: 'polar',
        userId: buyer.userId,
      });
      expect(row?.providerUpdatedAt?.toISOString()).toBe(t2.toISOString());
      expect((await events(staleId))[0]?.outcome).toBe('stale');
    });

    it('cancelling records the state and grants nothing more without an order.paid', async () => {
      const before = (await grants(buyer.userId)).length;
      const base = Date.now() + 1_000;
      await postPolar(
        subscriptionEvent('subscription.canceled', {
          userId: buyer.userId,
          status: 'active',
          cancelAtPeriodEnd: true,
          modifiedAt: new Date(base),
        }),
      );
      let row = await prisma.subscription.findUnique({
        where: { externalId: `sub_${buyer.userId}` },
      });
      expect(row).toMatchObject({ status: 'active', cancelAtPeriodEnd: true });
      await postPolar(
        subscriptionEvent('subscription.revoked', {
          userId: buyer.userId,
          status: 'canceled',
          cancelAtPeriodEnd: true,
          modifiedAt: new Date(base + 1_000),
        }),
      );
      row = await prisma.subscription.findUnique({
        where: { externalId: `sub_${buyer.userId}` },
      });
      expect(row?.status).toBe('canceled');
      expect((await grants(buyer.userId)).length).toBe(before);
    });

    it('a top-up grants its pack, never expiring', async () => {
      await postPolar(
        orderPaid({
          id: `ord_topup_${run}`,
          userId: buyer.userId,
          reason: 'purchase',
        }),
      );
      const pack = (await grants(buyer.userId)).find(
        (g) => g.externalRef === `polar:order:ord_topup_${run}`,
      );
      expect(pack).toMatchObject({
        source: 'topup',
        amount: credits(250),
        expiresAt: null,
        costBasis: 500,
        currency: 'USD',
      });
    });

    it('the same delivery 3× grants once; the same order under a new webhook-id grants once', async () => {
      const payload = orderPaid({
        id: `ord_replay_${run}`,
        userId: buyer2.userId,
        reason: 'purchase',
      });
      const id = `evt_replay_${run}`;
      for (let i = 0; i < 3; i++)
        expect((await postPolar(payload, { id })).status).toBe(202);
      const resent = await postPolar(payload, { id: `evt_resent_${run}` });
      expect(resent.status).toBe(202);
      const packs = (await grants(buyer2.userId)).filter(
        (g) => g.externalRef === `polar:order:ord_replay_${run}`,
      );
      expect(packs).toHaveLength(1);
      expect(await events(id)).toHaveLength(1);
      expect((await events(`evt_resent_${run}`))[0]?.outcome).toBe(
        'duplicate_grant',
      );
    });

    it('a grant that fails inside the transaction leaves no dedup row, and the retry grants', async () => {
      const orderId = `ord_fail_${run}`;
      const id = `evt_fail_${run}`;
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "CreditGrant" ADD CONSTRAINT "billing_e2e_refuse" CHECK ("externalRef" <> 'polar:order:${orderId}')`,
      );
      const payload = orderPaid({
        id: orderId,
        userId: buyer2.userId,
        reason: 'purchase',
      });
      const failed = await postPolar(payload, { id });
      expect(failed.status).toBe(500);
      expect(await events(id)).toHaveLength(0);
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "CreditGrant" DROP CONSTRAINT "billing_e2e_refuse"',
      );
      const retried = await postPolar(payload, { id });
      expect(retried.status).toBe(202);
      expect((await events(id))[0]?.outcome).toBe('granted');
      expect(
        (await grants(buyer2.userId)).filter(
          (g) => g.externalRef === `polar:order:${orderId}`,
        ),
      ).toHaveLength(1);
    });

    it('grants nothing when customer.external_id differs from metadata.userId, or the account is not allowlisted', async () => {
      const mismatch = `evt_mismatch_${run}`;
      const res = await postPolar(
        orderPaid({
          id: `ord_mismatch_${run}`,
          userId: buyer2.userId,
          reason: 'purchase',
          externalId: buyer.userId,
        }),
        { id: mismatch },
      );
      expect(res.status).toBe(202);
      expect((await events(mismatch))[0]?.outcome).toBe(
        'refused_user_mismatch',
      );
      const refused = `evt_outsider_${run}`;
      await postPolar(
        orderPaid({
          id: `ord_outsider_${run}`,
          userId: outsider.userId,
          reason: 'purchase',
        }),
        { id: refused },
      );
      expect((await events(refused))[0]?.outcome).toBe('refused_allowlist');
      const refs = [
        `polar:order:ord_mismatch_${run}`,
        `polar:order:ord_outsider_${run}`,
      ];
      expect(
        await prisma.creditGrant.count({
          where: { externalRef: { in: refs } },
        }),
      ).toBe(0);
      // The money is not lost: each paid order is a row the owner can settle.
      const reviews = await prisma.paymentOrder.findMany({
        where: { externalRef: { in: refs } },
        orderBy: { externalRef: 'asc' },
      });
      expect(reviews).toMatchObject([
        {
          provider: 'polar',
          status: 'needs_review',
          reviewReason: 'user_mismatch',
          userId: null,
          planCode: 'topup_250',
          amountMinor: 500,
          currency: 'USD',
        },
        {
          provider: 'polar',
          status: 'needs_review',
          reviewReason: 'refused_allowlist',
          userId: outsider.userId,
          planCode: 'topup_250',
        },
      ]);
      // A redelivery under a new webhook id records nothing twice.
      await postPolar(
        orderPaid({
          id: `ord_outsider_${run}`,
          userId: outsider.userId,
          reason: 'purchase',
        }),
      );
      expect(
        await prisma.paymentOrder.count({
          where: { externalRef: `polar:order:ord_outsider_${run}` },
        }),
      ).toBe(1);

      // resolve-payment grants the mismatched one to the named account, under
      // the order's own key, so a later redelivery cannot grant it again.
      const resolved = await admin.resolvePayment(reviews[0]!.id, 'grant', {
        userId: buyer2.userId,
      });
      expect(resolved).toMatchObject({
        state: 'granted',
        userId: buyer2.userId,
      });
      const replay = `evt_mismatch_replay_${run}`;
      await postPolar(
        orderPaid({
          id: `ord_mismatch_${run}`,
          userId: buyer2.userId,
          reason: 'purchase',
        }),
        { id: replay },
      );
      expect((await events(replay))[0]?.outcome).toBe('duplicate_grant');
      expect(
        await prisma.creditGrant.count({
          where: { externalRef: `polar:order:ord_mismatch_${run}` },
        }),
      ).toBe(1);
    });

    it('a paid order for a product no plan maps to is held for review', async () => {
      const id = `evt_unknown_product_${run}`;
      await postPolar(
        orderPaid({
          id: `ord_unknown_product_${run}`,
          userId: buyer.userId,
          reason: 'purchase',
          productId: 'prod_not_configured',
        }),
        { id },
      );
      expect((await events(id))[0]?.outcome).toBe('unknown_product');
      expect(
        await prisma.paymentOrder.findUnique({
          where: { externalRef: `polar:order:ord_unknown_product_${run}` },
        }),
      ).toMatchObject({
        status: 'needs_review',
        reviewReason: 'unknown_product',
        userId: buyer.userId,
        planCode: 'topup_250',
      });
    });

    it('a bad signature is 403 with no rows', async () => {
      const id = `evt_forged_${run}`;
      const res = await postPolar(
        orderPaid({
          id: `ord_forged_${run}`,
          userId: buyer.userId,
          reason: 'purchase',
        }),
        { id, secret: newPolarSecret() },
      );
      expect(res.status).toBe(403);
      expect(await events(id)).toHaveLength(0);
      expect(
        await prisma.creditGrant.count({
          where: { externalRef: `polar:order:ord_forged_${run}` },
        }),
      ).toBe(0);
    });

    it('acknowledges an unknown event type with 202', async () => {
      const id = `evt_unknown_${run}`;
      const res = await postPolar(
        {
          type: 'customer.state_changed',
          timestamp: new Date().toISOString(),
          data: { id: `cus_${run}` },
        },
        { id },
      );
      expect(res.status).toBe(202);
      expect((await events(id))[0]?.outcome).toBe('ignored');
    });
  });

  describe('SePay', () => {
    it('a matching transfer grants, marks the order paid and answers exactly {"success":true}; a duplicate grants once', async () => {
      const order = await sepayOrder(buyer, 'topup_250');
      expect(order.amountVnd).toBe(125000);
      expect(order.orderCode).toMatch(/^CHF[A-Z2-7]{8}$/);
      const qr = new URL(order.qrUrl);
      expect(qr.origin + qr.pathname).toBe('https://vietqr.app/img');
      expect(Object.fromEntries(qr.searchParams)).toEqual({
        acc: '0123456789',
        bank: 'MBBank',
        amount: '125000',
        des: order.orderCode,
        template: 'compact',
      });

      const paid = transfer(order.orderCode, 125000);
      const first = await postSepay(paid);
      expect(first.status).toBe(200);
      expect(first.body).toBe('{"success":true}');
      const again = await postSepay(paid);
      expect(again.status).toBe(200);
      expect(again.body).toBe('{"success":true}');

      const packs = (await grants(buyer.userId)).filter(
        (g) => g.externalRef === `sepay:tx:${paid.id}`,
      );
      expect(packs).toHaveLength(1);
      expect(packs[0]).toMatchObject({
        source: 'topup',
        amount: credits(250),
        expiresAt: null,
        costBasis: 125000,
        currency: 'VND',
      });
      const status = await http()
        .get(`/billing/orders/${order.orderId}`)
        .set('Authorization', buyer.bearer);
      expect(
        successBody(
          status,
          z.object({ status: z.string(), paidAt: z.string() }),
        ).data.status,
      ).toBe('paid');
      expect(
        (
          await http()
            .get(`/billing/orders/${order.orderId}`)
            .set('Authorization', buyer2.bearer)
        ).status,
      ).toBe(404);
    });

    it('a code in the memo text is found when SePay sends no code', async () => {
      const order = await sepayOrder(buyer2, 'topup_250');
      const paid = transfer(
        null,
        125000,
        `NGUYEN VAN A ${order.orderCode.toLowerCase()} chuyen tien`,
      );
      expect((await postSepay(paid)).body).toBe('{"success":true}');
      expect(
        await prisma.creditGrant.count({
          where: { externalRef: `sepay:tx:${paid.id}` },
        }),
      ).toBe(1);
    });

    it('a wrong amount sets needs_review / amount_mismatch and grants nothing', async () => {
      const order = await sepayOrder(buyer, 'topup_250');
      const short = transfer(order.orderCode, 120000);
      const res = await postSepay(short);
      expect(res.status).toBe(200);
      expect(res.body).toBe('{"success":true}');
      const row = await prisma.paymentOrder.findUnique({
        where: { id: order.orderId },
      });
      expect(row).toMatchObject({
        status: 'needs_review',
        reviewReason: 'amount_mismatch',
        planCode: 'topup_250',
        paidAmountVnd: 120000,
        externalRef: `sepay:tx:${short.id}`,
      });
      expect(
        await prisma.creditGrant.count({
          where: { externalRef: `sepay:tx:${short.id}` },
        }),
      ).toBe(0);
    });

    it('an underpaid order keeps its plan, and resolve grants the plan the amount buys', async () => {
      const order = await sepayOrder(buyer, 'topup_1500');
      const short = transfer(order.orderCode, 125000);
      expect((await postSepay(short)).body).toBe('{"success":true}');
      expect(
        await prisma.paymentOrder.findUnique({ where: { id: order.orderId } }),
      ).toMatchObject({
        status: 'needs_review',
        reviewReason: 'amount_mismatch',
        planCode: 'topup_1500',
        paidAmountVnd: 125000,
      });

      const resolved = await admin.resolvePayment(order.orderId, 'grant');
      expect(resolved.state).toBe('granted');
      const granted = await prisma.creditGrant.findMany({
        where: { externalRef: `sepay:tx:${short.id}` },
      });
      expect(granted).toHaveLength(1);
      expect(granted[0]).toMatchObject({
        userId: buyer.userId,
        amount: credits(250),
      });
    });

    it('an amount no plan costs names no plan: resolve refuses until --plan names a catalogue one', async () => {
      const order = await sepayOrder(buyer2, 'topup_550');
      const odd = transfer(order.orderCode, 100000);
      expect((await postSepay(odd)).body).toBe('{"success":true}');
      expect(
        (await prisma.paymentOrder.findUnique({ where: { id: order.orderId } }))
          ?.planCode,
      ).toBe('topup_550');

      await expect(
        admin.resolvePayment(order.orderId, 'grant'),
      ).rejects.toThrow(/names no plan/);
      await expect(
        admin.resolvePayment(order.orderId, 'grant', { planCode: 'nope' }),
      ).rejects.toThrow(/No plan nope/);
      await expect(
        admin.resolvePayment(order.orderId, 'grant', { planCode: 'free' }),
      ).rejects.toThrow(/cannot be granted/);
      expect(
        await prisma.creditGrant.count({
          where: { externalRef: `sepay:tx:${odd.id}` },
        }),
      ).toBe(0);

      const resolved = await admin.resolvePayment(order.orderId, 'grant', {
        planCode: 'topup_250',
      });
      expect(resolved.state).toBe('granted');
      expect(
        await prisma.paymentOrder.findUnique({ where: { id: order.orderId } }),
      ).toMatchObject({ status: 'resolved_granted', planCode: 'topup_250' });
      expect(
        await prisma.creditGrant.findUnique({
          where: { externalRef: `sepay:tx:${odd.id}` },
        }),
      ).toMatchObject({ userId: buyer2.userId, amount: credits(250) });
    });

    it('a correct transfer after an underpay settles the order, which resolve then refuses; the underpay stays reviewable alone', async () => {
      const order = await sepayOrder(buyer, 'topup_550');
      const short = transfer(order.orderCode, 125000);
      expect((await postSepay(short)).body).toBe('{"success":true}');
      const paid = transfer(order.orderCode, 250000);
      expect((await postSepay(paid)).body).toBe('{"success":true}');

      expect(
        await prisma.paymentOrder.findUnique({ where: { id: order.orderId } }),
      ).toMatchObject({
        status: 'paid',
        reviewReason: null,
        paidAmountVnd: 250000,
        externalRef: `sepay:tx:${paid.id}`,
      });
      expect(
        await prisma.creditGrant.findUnique({
          where: { externalRef: `sepay:tx:${paid.id}` },
        }),
      ).toMatchObject({ userId: buyer.userId, amount: credits(550) });
      expect(await admin.resolvePayment(order.orderId, 'grant')).toEqual({
        state: 'not_reviewable',
        status: 'paid',
      });

      // The short transfer is still money to settle, now on its own row and
      // filed under what it actually buys, never the plan that was ordered.
      const underpay = await prisma.paymentOrder.findUnique({
        where: { externalRef: `sepay:tx:${short.id}` },
      });
      expect(underpay).toMatchObject({
        userId: buyer.userId,
        provider: 'sepay',
        status: 'needs_review',
        reviewReason: 'amount_mismatch',
        planCode: 'topup_250',
        paidAmountVnd: 125000,
      });
      expect(underpay!.id).not.toBe(order.orderId);
      expect(
        await prisma.creditGrant.count({
          where: { externalRef: `sepay:tx:${short.id}` },
        }),
      ).toBe(0);
    });

    it('a correct transfer after an underpay was dismissed still buys the plan that was ordered', async () => {
      const order = await sepayOrder(buyer2, 'topup_550');
      const short = transfer(order.orderCode, 125000);
      expect((await postSepay(short)).body).toBe('{"success":true}');
      expect(await admin.resolvePayment(order.orderId, 'dismiss')).toEqual({
        state: 'dismissed',
      });
      const paid = transfer(order.orderCode, 250000);
      expect((await postSepay(paid)).body).toBe('{"success":true}');
      expect(
        await prisma.creditGrant.findUnique({
          where: { externalRef: `sepay:tx:${paid.id}` },
        }),
      ).toMatchObject({ userId: buyer2.userId, amount: credits(550) });
    });

    it('an unknown code becomes a needs_review row that resolve-payment grants once', async () => {
      const stray = transfer('CHFZZZZZZZ2', 125000);
      expect((await postSepay(stray)).body).toBe('{"success":true}');
      const row = await prisma.paymentOrder.findUnique({
        where: { externalRef: `sepay:tx:${stray.id}` },
      });
      expect(row).toMatchObject({
        userId: null,
        status: 'needs_review',
        reviewReason: 'unknown_code',
        planCode: 'topup_250',
        paidAmountVnd: 125000,
      });

      const resolved = await admin.resolvePayment(row!.id, 'grant', {
        userId: buyer2.userId,
      });
      expect(resolved.state).toBe('granted');
      expect(
        (
          await admin.resolvePayment(row!.id, 'grant', {
            userId: buyer2.userId,
          })
        ).state,
      ).toBe('not_reviewable');
      expect((await postSepay(stray)).body).toBe('{"success":true}');
      const granted = await prisma.creditGrant.findMany({
        where: { externalRef: `sepay:tx:${stray.id}` },
      });
      expect(granted).toHaveLength(1);
      expect(granted[0]).toMatchObject({
        userId: buyer2.userId,
        amount: credits(250),
      });
    });

    it('a matching transfer after the order expired still grants, and is logged as late', async () => {
      const order = await sepayOrder(buyer2, 'topup_250');
      await prisma.paymentOrder.update({
        where: { id: order.orderId },
        data: { status: 'expired', expiresAt: new Date(Date.now() - 2 * HOUR) },
      });
      const log = vi.spyOn(Logger.prototype, 'log');
      const paid = transfer(order.orderCode, 125000);
      expect((await postSepay(paid)).body).toBe('{"success":true}');
      expect(
        await prisma.creditGrant.count({
          where: { externalRef: `sepay:tx:${paid.id}` },
        }),
      ).toBe(1);
      expect(
        (await prisma.paymentOrder.findUnique({ where: { id: order.orderId } }))
          ?.status,
      ).toBe('paid');
      expect(
        log.mock.calls.some(
          ([line]) =>
            String(line).includes(`sepay tx ${paid.id}`) &&
            String(line).includes('late by'),
        ),
      ).toBe(true);
      log.mockRestore();
    });

    it('a 30-day pass makes the account Pro until its own expiry', async () => {
      const order = await sepayOrder(buyer2, 'pro_pass_30d');
      expect(order.amountVnd).toBe(249000);
      const paid = transfer(order.orderCode, 249000);
      expect((await postSepay(paid)).body).toBe('{"success":true}');
      const pass = await prisma.creditGrant.findUnique({
        where: { externalRef: `sepay:tx:${paid.id}` },
      });
      expect(pass).toMatchObject({ source: 'pass', amount: credits(600) });
      const days =
        (pass!.expiresAt!.getTime() - pass!.startsAt!.getTime()) / DAY;
      expect(days).toBe(30);
      const sub = await prisma.subscription.findUnique({
        where: { externalId: `sepay:pass:${buyer2.userId}` },
      });
      expect(sub?.currentPeriodEnd?.toISOString()).toBe(
        pass!.expiresAt!.toISOString(),
      );
    });

    it('a bad signature is 401 and writes nothing', async () => {
      const forged = transfer('CHFZZZZZZZ3', 125000);
      const res = await postSepay(forged, 'not-the-secret');
      expect(res.status).toBe(401);
      expect(
        await prisma.webhookEvent.count({
          where: { provider: 'sepay', eventId: String(forged.id) },
        }),
      ).toBe(0);
      expect(
        await prisma.paymentOrder.count({
          where: { externalRef: `sepay:tx:${forged.id}` },
        }),
      ).toBe(0);
    });
  });

  describe('checkout', () => {
    it('refuses a non-allowlisted account with 403 CHECKOUT_NOT_OPEN', async () => {
      const res = await http()
        .post('/billing/checkout')
        .set('Authorization', outsider.bearer)
        .send({ planCode: 'topup_250', rail: 'sepay' });
      expect(res.status).toBe(403);
      expect(errorBody(res).error.code).toBe('CHECKOUT_NOT_OPEN');
      const me = successBody(
        await http().get('/billing/me').set('Authorization', outsider.bearer),
        creditBalanceSchema,
      ).data;
      expect(me.checkoutAllowed).toBe(false);
    });

    it('answers 400 for a plan the rail does not sell', async () => {
      for (const body of [
        { planCode: 'pro_pass_30d', rail: 'polar' },
        { planCode: 'pro_monthly', rail: 'sepay' },
        { planCode: 'no_such_plan', rail: 'sepay' },
      ]) {
        const res = await http()
          .post('/billing/checkout')
          .set('Authorization', buyer.bearer)
          .send(body);
        expect(res.status).toBe(400);
      }
    });
  });
});
