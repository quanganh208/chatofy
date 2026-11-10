import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// The credit ledger against a REAL Postgres.
//
// What only a database can prove: that twenty connections spending one user's
// credits at once never take a grant below zero or past the balance (the
// advisory lock and the CHECK constraint), that a lease reaped while its socket
// idled is never released twice (the compare-and-set), that a held lock turns
// into a bounded `LedgerUnavailableError` instead of a hung request, and that an
// unrelated query still answers while a burst waits on the lock.
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { WsAdapter } from '@nestjs/platform-ws';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  CREDIT_SECONDS_PER_CREDIT,
  creditBalanceSchema,
  creditUsageListResponseSchema,
  planListResponseSchema,
} from '@chatofy/types';
import { AppModule } from '../src/app.module';
import { requestIdMiddleware } from '../src/common/middleware/request-id.middleware';
import { billingMonthKey } from '../src/modules/credits/billing-period';
import {
  CREDIT_LEDGER,
  LedgerUnavailableError,
  type CreditLedgerPort,
} from '../src/modules/credits/credit-ledger.port';
import { CreditLeaseReaper } from '../src/modules/credits/credit-lease-reaper';
import { CreditOwnerTools } from '../src/modules/credits/credit-owner-tools.service';
import {
  CreditUsageReader,
  USAGE_PAGE_SIZE,
} from '../src/modules/credits/credit-usage.reader';
import { PrismaService } from '../src/prisma/prisma.service';
import { registerAndLogin, type Identity } from './utils/auth-fixture';
import { successBody } from './utils/response-body';

const run = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const FREE = 120 * CREDIT_SECONDS_PER_CREDIT;
const credits = (n: number) => n * CREDIT_SECONDS_PER_CREDIT;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('credit ledger (db-e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let ledger: CreditLedgerPort;
  let admin: CreditOwnerTools;
  let reaper: CreditLeaseReaper;
  let reader: Identity;
  const users: string[] = [];
  /** A user id of its own per case; `userId` is a plain column, so no account row is needed. */
  const user = (name: string) => {
    const id = `credits-${name}-${run}`;
    users.push(id);
    return id;
  };

  const grants = (userId: string) =>
    prisma.creditGrant.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
  const topup = (userId: string, n: number, ref = `topup-${userId}`) =>
    ledger.grant({
      userId,
      source: 'topup',
      amount: credits(n),
      costBasis: 500,
      currency: 'USD',
      externalRef: ref,
    });

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useWebSocketAdapter(new WsAdapter(app));
    app.use(requestIdMiddleware);
    await app.init();
    prisma = app.get(PrismaService);
    ledger = app.get<CreditLedgerPort>(CREDIT_LEDGER);
    admin = app.get(CreditOwnerTools);
    reaper = app.get(CreditLeaseReaper);
    reader = await registerAndLogin(app, {
      email: `credits-${run}@db-e2e.example.com`,
    });
    users.push(reader.userId);
  });

  afterAll(async () => {
    await prisma.creditEntry.deleteMany({ where: { userId: { in: users } } });
    await prisma.creditLease.deleteMany({ where: { userId: { in: users } } });
    await prisma.creditGrant.deleteMany({ where: { userId: { in: users } } });
    await prisma.subscription.deleteMany({ where: { userId: { in: users } } });
    await prisma.paymentOrder.deleteMany({
      where: { id: { startsWith: `order-${run}` } },
    });
    await prisma.user.deleteMany({ where: { email: { contains: run } } });
    await app.close();
  });

  describe('20 parallel spends on one user', () => {
    it('never goes below zero or past the balance, spends Free before a top-up, and leaves other queries alone', async () => {
      const userId = user('burst-free');
      await topup(userId, 250);
      const start = FREE + credits(250);
      const want = credits(40); // 20 × 40 credits is far more than the 370 there are

      let slowest = 0;
      let bursting = true;
      const probe = (async () => {
        while (bursting) {
          const t0 = performance.now();
          await prisma.user.findFirst({ where: { email: reader.email } });
          slowest = Math.max(slowest, performance.now() - t0);
          await sleep(5);
        }
      })();
      const leases = await Promise.all(
        Array.from({ length: 20 }, () => ledger.openLease(userId, want)),
      );
      bursting = false;
      await probe;

      expect(leases.reduce((sum, l) => sum + l.held, 0)).toBe(start);
      const held = await grants(userId);
      expect(held.every((g) => g.remaining === 0)).toBe(true);
      expect(slowest).toBeLessThan(500);

      // Every connection then consumes more than it holds, at once.
      const settles = await Promise.all(
        leases.map((l, i) =>
          ledger.settleLease({
            leaseId: l.leaseId,
            seconds: l.held + 100,
            sessionId: `burst-${run}-${i}`,
          }),
        ),
      );
      await Promise.all(leases.map((l) => ledger.closeLease(l.leaseId)));
      const covered = settles.reduce(
        (sum, s) => sum + (s.state === 'ok' ? s.covered : 0),
        0,
      );
      const uncovered = settles.reduce(
        (sum, s) => sum + (s.state === 'ok' ? s.uncovered : 0),
        0,
      );
      expect(covered).toBe(start);
      expect(uncovered).toBe(2_000);
      expect(covered + uncovered).toBeLessThanOrEqual(start + want);
      const after = await grants(userId);
      expect(after.every((g) => g.remaining >= 0)).toBe(true);
      const uncoveredRows = await prisma.creditEntry.count({
        where: { userId, kind: 'settle', reason: 'overshoot_uncovered' },
      });
      expect(uncoveredRows).toBe(20);
    });

    it('drains Pro before a top-up, and gives unspent holdings back on close', async () => {
      const userId = user('burst-pro');
      const expiresAt = new Date(Date.now() + 30 * 86_400_000);
      await ledger.grant({
        userId,
        source: 'pass',
        planCode: 'pro_pass_30d',
        amount: credits(600),
        expiresAt,
        costBasis: 249_000,
        externalRef: `pass-${userId}`,
      });
      await topup(userId, 250);
      const leases = await Promise.all(
        Array.from({ length: 20 }, () => ledger.openLease(userId, 2_000)),
      );
      const [pro, top] = await grants(userId);
      expect(pro!.source).toBe('pass');
      expect(pro!.remaining).toBe(0);
      expect(top!.remaining).toBe(credits(250) - 4_000);
      // No Free grant during a live Pro period.
      expect((await grants(userId)).some((g) => g.source === 'free')).toBe(
        false,
      );

      await Promise.all(
        leases.map((l, i) =>
          ledger.settleLease({
            leaseId: l.leaseId,
            seconds: 1_000,
            sessionId: `pro-${run}-${i}`,
          }),
        ),
      );
      await Promise.all(leases.map((l) => ledger.closeLease(l.leaseId)));
      const total = (await grants(userId)).reduce(
        (sum, g) => sum + g.remaining,
        0,
      );
      expect(total).toBe(credits(600) + credits(250) - 20_000);
    });
  });

  it('answers not_open to every call on a reaped lease, and conserves credit across a reopen', async () => {
    const userId = user('reaped');
    const start = (await ledger.balance(userId)).available;
    expect(start).toBe(FREE);

    const first = await ledger.openLease(userId, 240);
    await ledger.settleLease({
      leaseId: first.leaseId,
      seconds: 60,
      sessionId: `reap-${run}-1`,
    });
    await prisma.creditLease.update({
      where: { id: first.leaseId },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    await reaper.tick();
    expect(
      (
        await prisma.creditLease.findUniqueOrThrow({
          where: { id: first.leaseId },
        })
      ).status,
    ).toBe('reaped');

    // The socket comes back from idle, speaks, and disconnects — all on the reaped lease.
    expect(await ledger.extendLease(first.leaseId, 240)).toEqual({
      state: 'not_open',
    });
    expect(
      await ledger.settleLease({
        leaseId: first.leaseId,
        seconds: 30,
        sessionId: `reap-${run}-2`,
      }),
    ).toEqual({ state: 'not_open' });
    expect(await ledger.closeLease(first.leaseId)).toEqual({
      state: 'not_open',
    });

    const second = await ledger.openLease(userId, 240);
    expect(second.held).toBe(240);
    await ledger.settleLease({
      leaseId: second.leaseId,
      seconds: 30,
      sessionId: `reap-${run}-2`,
    });
    await ledger.closeLease(second.leaseId);

    const remaining = (await grants(userId)).reduce(
      (sum, g) => sum + g.remaining,
      0,
    );
    const settled = await prisma.creditEntry.aggregate({
      where: { userId, kind: 'settle' },
      _sum: { amount: true },
    });
    expect(remaining + -(settled._sum.amount ?? 0)).toBe(start);
    expect(-(settled._sum.amount ?? 0)).toBe(90);
    const releases = await prisma.creditEntry.count({
      where: { userId, kind: 'release', leaseId: first.leaseId },
    });
    expect(releases).toBe(1);
  });

  it('turns a held user lock into LedgerUnavailableError within the bound, while the balance still reads', async () => {
    const userId = user('locked');
    await topup(userId, 10);
    let locked!: () => void;
    const lockTaken = new Promise<void>((resolve) => (locked = resolve));
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
        locked();
        await sleep(3_500);
      },
      { timeout: 10_000 },
    );
    await lockTaken;
    // The read path takes no lock: it answers at once, Free grant included.
    const r0 = performance.now();
    expect((await ledger.balance(userId)).available).toBe(FREE + credits(10));
    expect(performance.now() - r0).toBeLessThan(1_000);
    const t0 = performance.now();
    await expect(
      ledger.debit({ userId, amount: 60, idempotencyKey: `locked-${run}` }),
    ).rejects.toBeInstanceOf(LedgerUnavailableError);
    expect(performance.now() - t0).toBeLessThan(3_000);
    await holder;
  });

  describe('Free grant', () => {
    it('is written once per user and month, however many reads race for it', async () => {
      const userId = user('free-once');
      await Promise.all(
        Array.from({ length: 5 }, () => ledger.balance(userId)),
      );
      await ledger.balance(userId);
      const free = (await grants(userId)).filter((g) => g.source === 'free');
      expect(free).toHaveLength(1);
      expect(free[0]!.externalRef).toBe(
        `free:${userId}:${billingMonthKey(new Date())}`,
      );
      expect(free[0]!.amount).toBe(FREE);
    });

    it('is not written while a Pro grant is live', async () => {
      const userId = user('free-pro');
      await ledger.grant({
        userId,
        source: 'subscription',
        planCode: 'pro_monthly',
        amount: credits(600),
        expiresAt: new Date(Date.now() + 86_400_000),
        externalRef: `sub-${userId}`,
      });
      const balance = await ledger.balance(userId);
      expect(balance.plan).toBe('pro');
      expect(balance.proSource).toBe('subscription');
      expect((await grants(userId)).some((g) => g.source === 'free')).toBe(
        false,
      );
    });

    it('is not written while a Polar subscription renews, within the grace after its period', async () => {
      const userId = user('free-renewing');
      const ended = new Date(Date.now() - 3_600_000);
      await ledger.grant({
        userId,
        source: 'subscription',
        planCode: 'pro_monthly',
        amount: credits(600),
        startsAt: new Date(ended.getTime() - 30 * 86_400_000),
        expiresAt: ended,
        externalRef: `sub-renewing-${userId}`,
      });
      await prisma.subscription.create({
        data: {
          userId,
          provider: 'polar',
          externalId: `sub-renewing-${run}`,
          status: 'active',
          currentPeriodEnd: ended,
        },
      });
      await ledger.balance(userId);
      await ledger
        .openLease(userId, 0)
        .then((l) => ledger.closeLease(l.leaseId));
      expect((await grants(userId)).some((g) => g.source === 'free')).toBe(
        false,
      );

      // Set to cancel at the period end: the gap is real, Free is due.
      await prisma.subscription.update({
        where: { externalId: `sub-renewing-${run}` },
        data: { cancelAtPeriodEnd: true },
      });
      await ledger.balance(userId);
      expect((await grants(userId)).some((g) => g.source === 'free')).toBe(
        true,
      );
    });

    it('is written once the renewal grace has run out', async () => {
      const userId = user('free-lapsed');
      await prisma.subscription.create({
        data: {
          userId,
          provider: 'polar',
          externalId: `sub-lapsed-${run}`,
          status: 'active',
          currentPeriodEnd: new Date(Date.now() - 49 * 3_600_000),
        },
      });
      await ledger.balance(userId);
      expect((await grants(userId)).some((g) => g.source === 'free')).toBe(
        true,
      );
    });

    it("expires last month's grant at the rollover and writes this month's", async () => {
      const userId = user('rollover');
      const old = await prisma.creditGrant.create({
        data: {
          userId,
          source: 'free',
          planCode: 'free',
          amount: FREE,
          remaining: 1_000,
          expiresAt: new Date(Date.now() - 60_000),
          externalRef: `free:${userId}:1999-01`,
        },
      });
      const balance = await ledger.balance(userId);
      expect(balance.available).toBe(FREE);
      // The read leaves the stale grant out without writing it off; the next
      // spend (or the reaper) marks it.
      expect(
        (await prisma.creditGrant.findUniqueOrThrow({ where: { id: old.id } }))
          .status,
      ).toBe('active');
      await ledger.debit({ userId, amount: 60, idempotencyKey: `roll-${run}` });
      const expired = await prisma.creditGrant.findUniqueOrThrow({
        where: { id: old.id },
      });
      expect(expired).toMatchObject({ status: 'expired', remaining: 0 });
      const entry = await prisma.creditEntry.findUniqueOrThrow({
        where: { idempotencyKey: `expire:${old.id}` },
      });
      expect(entry.amount).toBe(-1_000);
    });
  });

  it('refuses a debit it cannot cover, debits once per key, and refunds to the same grants', async () => {
    const userId = user('debit');
    expect(
      await ledger.debit({
        userId,
        amount: FREE + 1,
        idempotencyKey: `minutes:${userId}:big`,
      }),
    ).toMatchObject({ state: 'insufficient', available: FREE });
    const key = `minutes:${userId}`;
    expect(
      await ledger.debit({ userId, amount: 180, idempotencyKey: key }),
    ).toMatchObject({ state: 'ok', duplicate: false });
    expect(
      await ledger.debit({ userId, amount: 180, idempotencyKey: key }),
    ).toMatchObject({ state: 'ok', duplicate: true });
    expect((await ledger.balance(userId)).available).toBe(FREE - 180);
    expect(
      await ledger.refund({
        userId,
        debitKey: key,
        idempotencyKey: `refund:${userId}`,
      }),
    ).toEqual({ state: 'ok', refunded: 180, duplicate: false });
    expect(
      await ledger.refund({
        userId,
        debitKey: key,
        idempotencyKey: `refund:${userId}`,
      }),
    ).toMatchObject({ duplicate: true });
    expect((await ledger.balance(userId)).available).toBe(FREE);
  });

  it('voids a grant idempotently, leaving the Free grant only', async () => {
    const userId = user('void');
    const promo = await ledger.grant({
      userId,
      source: 'promo',
      amount: credits(10),
      externalRef: `promo:${userId}`,
      reason: 'demo',
    });
    expect((await ledger.balance(userId)).available).toBe(FREE + credits(10));
    expect(await admin.voidGrant(promo.grantId)).toMatchObject({
      state: 'voided',
      amount: credits(10),
    });
    expect(await admin.voidGrant(promo.grantId)).toEqual({
      state: 'already_voided',
    });
    expect((await ledger.balance(userId)).available).toBe(FREE);
    // A replayed grant reports the existing row instead of raising.
    expect(
      await ledger.grant({
        userId,
        source: 'promo',
        amount: credits(10),
        externalRef: `promo:${userId}`,
      }),
    ).toEqual({
      state: 'duplicate',
      grantId: promo.grantId,
    });
  });

  it('resolves a reviewed payment by granting under the transfer reference, or by dismissing it', async () => {
    const userId = user('review');
    const order = (suffix: string, txId: string) =>
      prisma.paymentOrder.create({
        data: {
          id: `order-${run}-${suffix}`,
          userId,
          provider: 'sepay',
          planCode: 'topup_250',
          amountMinor: 125_000,
          currency: 'VND',
          amountVnd: 125_000,
          paidAmountVnd: 120_000,
          externalRef: `sepay:tx:${run}-${txId}`,
          status: 'needs_review',
          reviewReason: 'amount_mismatch',
          expiresAt: new Date(),
          paidAt: new Date(),
        },
      });
    const toGrant = await order('g', '1');
    // 120,000đ buys no plan, so the owner names the one they are granting.
    await expect(admin.resolvePayment(toGrant.id, 'grant')).rejects.toThrow(
      /names no plan/,
    );
    const granted = await admin.resolvePayment(toGrant.id, 'grant', {
      note: 'customer confirmed',
      planCode: 'topup_250',
    });
    expect(granted).toMatchObject({ state: 'granted', userId });
    const grant = await prisma.creditGrant.findUniqueOrThrow({
      where: { externalRef: `sepay:tx:${run}-1` },
    });
    expect(grant).toMatchObject({
      source: 'topup',
      amount: credits(250),
      expiresAt: null,
      costBasis: 120_000,
    });
    expect(
      await prisma.paymentOrder.findUniqueOrThrow({
        where: { id: toGrant.id },
      }),
    ).toMatchObject({
      status: 'resolved_granted',
      resolvedNote: 'customer confirmed',
    });
    expect(await admin.resolvePayment(toGrant.id, 'grant')).toMatchObject({
      state: 'not_reviewable',
    });

    const toDismiss = await order('d', '2');
    expect(
      await admin.resolvePayment(toDismiss.id, 'dismiss', {
        note: 'refunded by bank',
      }),
    ).toEqual({ state: 'dismissed' });
    const dismissed = await prisma.paymentOrder.findUniqueOrThrow({
      where: { id: toDismiss.id },
    });
    expect(dismissed.status).toBe('resolved_dismissed');
    expect(dismissed.resolvedAt).not.toBeNull();
  });

  it('reaper releases an expired lease back to its grant', async () => {
    const userId = user('reaper');
    const lease = await ledger.openLease(userId, 600);
    expect((await ledger.balance(userId)).available).toBe(FREE - 600);
    await prisma.creditLease.update({
      where: { id: lease.leaseId },
      data: { expiresAt: new Date(Date.now() - 1) },
    });
    await reaper.tick();
    expect(
      (
        await prisma.creditLease.findUniqueOrThrow({
          where: { id: lease.leaseId },
        })
      ).status,
    ).toBe('reaped');
    expect((await ledger.balance(userId)).available).toBe(FREE);
  });

  describe('HTTP', () => {
    it('lists the six plans without a token', async () => {
      const res = await request(app.getHttpServer())
        .get('/billing/plans')
        .expect(200);
      const { data } = successBody(res, planListResponseSchema);
      expect(data.plans.map((p) => p.code)).toEqual([
        'free',
        'pro_monthly',
        'pro_pass_30d',
        'topup_250',
        'topup_550',
        'topup_1500',
      ]);
      // No rail is open on this deployment yet.
      expect(data.plans.every((p) => p.rails.length === 0)).toBe(true);
    });

    it("shows the caller's balance, counting an open lease's holding as theirs", async () => {
      const lease = await ledger.openLease(reader.userId, 600);
      const res = await request(app.getHttpServer())
        .get('/billing/me')
        .set('Authorization', reader.bearer)
        .expect(200);
      const { data } = successBody(res, creditBalanceSchema);
      expect(data).toMatchObject({
        totalCredits: 120,
        planCredits: 120,
        topupCredits: 0,
        plan: 'free',
        proSource: null,
        checkoutAllowed: false,
        rails: { polar: 'unavailable', sepay: 'unavailable' },
      });
      await ledger.settleLease({
        leaseId: lease.leaseId,
        seconds: 90,
        sessionId: `http-${run}`,
        conversationId: `conv-${run}`,
      });
      await ledger.closeLease(lease.leaseId);
    });

    it('pages usage, one translation row per conversation, newest first', async () => {
      const res = await request(app.getHttpServer())
        .get('/billing/usage')
        .set('Authorization', reader.bearer)
        .expect(200);
      const { data } = successBody(res, creditUsageListResponseSchema);
      expect(data.entries.map((e) => e.kind)).toEqual(['translate', 'grant']);
      expect(data.entries[0]).toMatchObject({
        credits: -1.5,
        conversationId: `conv-${run}`,
      });
      expect(data.entries[1]).toMatchObject({
        credits: 120,
        label: 'Free monthly credits',
      });
      expect(data.nextCursor).toBeNull();
    });

    it('pages a long history through a small scan window the same as reading it whole', async () => {
      const userId = user('usage-window');
      await topup(userId, 100);
      const base = Date.now() - 10 * 86_400_000;
      // Seven conversations over five days, a connection row whose settles
      // span all of them, and a debit split across two entries.
      const entries = [];
      for (let i = 0; i < 60; i += 1) {
        const at = new Date(base + i * 2 * 3_600_000);
        entries.push({
          userId,
          kind: 'settle',
          amount: -(i + 1),
          conversationId: `conv-${i % 7}-${run}`,
          sessionId: `s-${i}-${run}`,
          idempotencyKey: `settle:win-${i}-${run}`,
          createdAt: at,
        });
        if (i % 5 === 0) {
          entries.push({
            userId,
            kind: 'settle',
            amount: -7,
            leaseId: `lease-win-${run}`,
            sessionId: `l-${i}-${run}`,
            idempotencyKey: `settle:winl-${i}-${run}`,
            createdAt: at,
          });
        }
      }
      for (const n of [0, 1]) {
        entries.push({
          userId,
          kind: 'debit',
          amount: -30,
          idempotencyKey:
            n === 0 ? `minutes:win-${run}` : `minutes:win-${run}#2`,
          createdAt: new Date(base + 5 * 3_600_000),
        });
      }
      await prisma.creditEntry.createMany({ data: entries });

      const usage = app.get(CreditUsageReader);
      const readAll = async (scan?: number) => {
        const rows = [];
        let cursor: string | undefined;
        for (let pages = 0; pages < 50; pages += 1) {
          const page = await usage.page(userId, cursor, scan);
          rows.push(...page.entries);
          if (!page.nextCursor) return rows;
          cursor = page.nextCursor;
        }
        throw new Error('paging did not finish');
      };
      const whole = await readAll();
      const windowed = await readAll(4);
      expect(windowed).toEqual(whole);
      expect(whole.find((r) => r.id === `l:lease-win-${run}`)?.credits).toBe(
        -(12 * 7) / 60,
      );
      expect(whole.find((r) => r.id === `k:minutes:win-${run}`)?.credits).toBe(
        -1,
      );
      expect(whole.length).toBeGreaterThan(USAGE_PAGE_SIZE);
    });

    it('requires a token for the balance', async () => {
      await request(app.getHttpServer()).get('/billing/me').expect(401);
    });
  });
});
