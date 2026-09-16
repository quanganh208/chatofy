import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
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
  implements OnModuleInit, OnModuleDestroy
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
      }),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
