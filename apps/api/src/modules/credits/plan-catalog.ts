import { Injectable } from '@nestjs/common';
import { CREDIT_SECONDS_PER_CREDIT } from '@chatofy/types';
import { PrismaService } from '../../prisma/prisma.service';

export interface PlanRow {
  code: string;
  kind: string;
  credits: number;
  priceUsdCents: number | null;
  priceVnd: number | null;
  periodDays: number | null;
  polar: boolean;
  sepay: boolean;
  active: boolean;
  sortOrder: number;
}

/** How long a read of the catalogue is reused. Plans change by migration only. */
const PLAN_CACHE_MS = 60_000;

/**
 * The `Plan` rows, read once a minute at most.
 *
 * Every reserve ensures the Free grant and needs its size, so reading the row
 * each time would add a query to the hottest ledger path for a value that only
 * a migration changes. Loaded lazily, never at boot: the fast e2e suites run the
 * app on a stubbed Prisma and must not see a query they did not expect.
 */
@Injectable()
export class PlanCatalog {
  private cache: { at: number; plans: PlanRow[] } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /** Every plan, inactive ones included, in display order. */
  async all(): Promise<PlanRow[]> {
    const now = Date.now();
    if (this.cache && now - this.cache.at < PLAN_CACHE_MS)
      return this.cache.plans;
    const plans = await this.prisma.plan.findMany({
      orderBy: { sortOrder: 'asc' },
    });
    this.cache = { at: now, plans };
    return plans;
  }

  async active(): Promise<PlanRow[]> {
    return (await this.all()).filter((plan) => plan.active);
  }

  async get(code: string): Promise<PlanRow | undefined> {
    return (await this.all()).find((plan) => plan.code === code);
  }

  /** The monthly Free allowance in credit-seconds; 0 when Free is switched off. */
  async freeCreditSeconds(): Promise<number> {
    const free = await this.get('free');
    return free?.active ? free.credits * CREDIT_SECONDS_PER_CREDIT : 0;
  }
}
