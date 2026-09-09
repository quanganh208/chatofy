import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Env } from '../../config/env.schema';
import {
  REDIS_CLIENT,
  RedisConnectionLifecycle,
  createRedisClient,
} from './redis-client.provider';

/**
 * The API's Redis seam: exports ONLY `REDIS_CLIENT`.
 *
 * Imported by AuthModule and nowhere else. It is NOT registered in AppModule —
 * a second import would give two modules ownership of one connection, and the
 * only consumer today is the refresh-token store.
 */
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        createRedisClient(config.get('REDIS_URL', { infer: true })),
    },
    RedisConnectionLifecycle,
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
