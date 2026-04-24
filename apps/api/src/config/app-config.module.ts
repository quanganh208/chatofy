import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './env.schema';

/**
 * Global config module — wraps @nestjs/config with zod validation.
 * Marked @Global so ConfigService is available everywhere without re-importing.
 */
@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      cache: true,
    }),
  ],
  exports: [ConfigModule],
})
export class AppConfigModule {}
