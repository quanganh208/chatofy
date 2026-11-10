import {
  Injectable,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

import type { Env } from '../config/env.schema';

/**
 * Wraps PrismaClient with NestJS lifecycle hooks.
 * Prisma 7 requires a driver adapter; PrismaPg connects over node-postgres.
 * OnModuleInit connects eagerly so the first request is not penalized.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnApplicationShutdown
{
  /**
   * The connection string arrives through ConfigService rather than from
   * `process.env` directly, which is what every other consumer in this app
   * does. Reading the raw environment here would have silently accepted an
   * empty string and turned a missing DATABASE_URL into a connection error at
   * first query; the schema requires a URL and refuses to boot without one.
   */
  constructor(config: ConfigService<Env, true>) {
    super({
      adapter: new PrismaPg({
        connectionString: config.get('DATABASE_URL', { infer: true }),
        // Explicit, not pg's default of 10. A ledger transaction waiting on a
        // user's advisory lock holds a connection while it waits, so what one
        // account can hold matters more than the total. The live meter runs at
        // most two ledger transactions per account at once and queues the rest
        // in memory (`UserLedgerGate`), refuses starts past a small in-flight
        // cap, and never reaches the ledger for a start a turn ceiling refuses;
        // `GET /billing/me` takes no lock. Every wait is bounded (`maxWait`,
        // `timeout`, `lock_timeout`). That leaves an account a handful of
        // connections at most, and the rest of the pool to everyone else.
        max: 20,
      }),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  /**
   * Disconnects at application shutdown, not module destroy. Nest runs every
   * `onModuleDestroy` before any `onApplicationShutdown`, so the providers that
   * write on their way out — the LLM call sink's final flush, the credits
   * reaper's tick in flight — always find the pool still open, whatever order
   * the module graph would destroy them in.
   */
  async onApplicationShutdown(): Promise<void> {
    await this.$disconnect();
  }
}
