import { Module } from '@nestjs/common';
import { MetaController } from './meta.controller';

/**
 * Meta module — exposes the root service descriptor.
 * No providers; ConfigService is available globally via AppConfigModule.
 */
@Module({
  controllers: [MetaController],
})
export class MetaModule {}
