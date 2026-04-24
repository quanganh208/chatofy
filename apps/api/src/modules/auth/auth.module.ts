import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { NoopAuthAdapter } from './adapters/noop-auth.adapter.js';
import { AUTH_ADAPTER } from './interfaces/auth-adapter.interface.js';

/**
 * Auth module — binds AUTH_ADAPTER token to NoopAuthAdapter by default.
 * To swap providers: replace the useClass here with the real adapter class,
 * or use a factory provider reading AUTH_PROVIDER from ConfigService.
 */
@Module({
  controllers: [AuthController],
  providers: [
    {
      provide: AUTH_ADAPTER,
      useClass: NoopAuthAdapter,
    },
  ],
  exports: [AUTH_ADAPTER],
})
export class AuthModule {}
