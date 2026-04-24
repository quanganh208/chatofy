import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

/**
 * Health module — no additional providers needed.
 * PrismaService is available globally via PrismaModule (@Global).
 */
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
