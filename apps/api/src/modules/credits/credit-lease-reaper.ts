import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreditLeases } from './credit-leases.service';
import { CreditOwnerTools } from './credit-owner-tools.service';
import { REAPER_INTERVAL_MS } from './credit-pricing';

export { REAPER_INTERVAL_MS };

/**
 * The ledger's housekeeping, in process.
 *
 * One API instance serves everything (the throttler and the call budget are in
 * memory too), so a plain `setInterval(...).unref()` is enough — the same shape
 * as the translate session sweep — and no scheduler dependency is needed. Each
 * tick: release leases whose connection died, expire due grants, and mark
 * pending payment orders past their window `expired` (display only: a late
 * matching transfer still grants).
 *
 * The first tick is one interval after boot, and every tick catches and logs
 * its own failure, so an app booted on a stubbed database (the fast e2e
 * suites) is not disturbed by it.
 */
@Injectable()
export class CreditLeaseReaper implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CreditLeaseReaper.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running: Promise<void> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly leases: CreditLeases,
    private readonly owner: CreditOwnerTools,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), REAPER_INTERVAL_MS);
    this.timer.unref?.();
  }

  /** Stops the timer and waits for a tick in flight, so nothing queries after the pool closes. */
  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.running;
  }

  /** One pass. Overlapping calls share the pass already running. */
  tick(now = new Date()): Promise<void> {
    if (!this.running) {
      this.running = this.pass(now).finally(() => {
        this.running = null;
      });
    }
    return this.running;
  }

  private async pass(now: Date): Promise<void> {
    try {
      const reaped = await this.leases.reapExpired(now);
      const expired = await this.owner.expireDue(now);
      const orders = await this.prisma.paymentOrder.updateMany({
        where: { status: 'pending', expiresAt: { lt: now } },
        data: { status: 'expired' },
      });
      if (reaped + expired + orders.count > 0) {
        this.logger.log(
          `credits reaper: leases=${reaped} grantsExpired=${expired} ordersExpired=${orders.count}`,
        );
      }
    } catch (err) {
      this.logger.warn(`credits reaper tick failed: ${String(err)}`);
    }
  }
}
