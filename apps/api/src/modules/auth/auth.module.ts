import { Module } from '@nestjs/common';
import { NoopAuthAdapter } from './adapters/noop-auth.adapter';
import { AuthController } from './auth.controller';
import { AUTH_ADAPTER } from './interfaces/auth-adapter.interface';

/**
 * Auth module — binds AUTH_ADAPTER token to NoopAuthAdapter by default.
 * Swap the provider value to any AuthAdapter implementation without changing consumers.
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
