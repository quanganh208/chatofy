import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

/**
 * Health module — controller only, no providers and no database dependency.
 */
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
