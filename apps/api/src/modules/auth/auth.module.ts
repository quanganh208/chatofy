import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Env } from '../../config/env.schema';
import { UsersModule } from '../users/users.module';
import { JwtAuthAdapter } from './adapters/jwt-auth.adapter';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { GoogleTokenVerifier } from './google-token-verifier';
import { ACCESS_TOKEN_TTL_SECONDS } from './auth.service';
import { AUTH_ADAPTER } from './interfaces/auth-adapter.interface';

/**
 * The API's identity authority: it hashes passwords, signs its own access
 * tokens, and verifies them again on the way back in.
 *
 * AUTH_ADAPTER stays the seam every consumer imports, so swapping to a hosted
 * provider later reaches this binding and nothing else.
 *
 * The global guard lives here too, so every route requires a token unless it
 * carries @Public(). There is no "auth off" mode to fall back to.
 */
@Module({
  imports: [
    UsersModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('AUTH_JWT_SECRET', { infer: true }),
        // Seconds, so this and AuthService's `expiresAt` are the same number
        // rather than two spellings of "7 days" that can drift apart.
        signOptions: { expiresIn: ACCESS_TOKEN_TTL_SECONDS },
      }),
    }),
    // Registered without a global guard: the throttle applies only where a
    // route asks for it with @Throttle, which today is the auth routes. A
    // blanket limit here would land on the audio frame path.
    ThrottlerModule.forRoot({
      // Phrased for a client, not as a class name: the exception's default
      // message reaches the error envelope verbatim, and "ThrottlerException:
      // Too Many Requests" is an implementation detail leaking into a contract.
      errorMessage: 'Too many requests — try again shortly',
      throttlers: [{ name: 'default', limit: 60, ttl: 60_000 }],
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    GoogleTokenVerifier,
    { provide: AUTH_ADAPTER, useClass: JwtAuthAdapter },
    // Registered HERE, not in CommonModule. CommonModule has no `imports` and
    // AuthModule is not @Global, so a guard registered there could never
    // resolve AUTH_ADAPTER. Registering it in the module that owns the token
    // keeps auth's DI surface narrow instead of making it global.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  exports: [AUTH_ADAPTER, AuthService],
})
export class AuthModule {}
