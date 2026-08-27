import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Env } from '../../config/env.schema';
import { MailModule } from '../mail/mail.module';
import { StorageModule } from '../storage/storage.module';
import { UsersModule } from '../users/users.module';
import { JwtAuthAdapter } from './adapters/jwt-auth.adapter';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthMailer } from './auth-mailer';
import { PasswordHasher } from './password-hasher';
import { RegistrationService } from './registration.service';
import { PasswordResetService } from './password-reset.service';
import { GoogleTokenVerifier } from './google-token-verifier';
import { PurposeTokenService } from './purpose-token';
import { SessionTerminator } from './session-terminator';
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
    // Register, forgot and reset all mail a link. Imported for MAIL_SENDER, the
    // only thing MailModule exports — the cooldown and the send budget live
    // inside the instance bound to it, so there is no unguarded sender to reach.
    MailModule,
    // For AVATAR_STORAGE, the only thing StorageModule exports. Which
    // implementation binds — R2 or the disabled one — is decided there from
    // configuration, so nothing in this module branches on whether R2 is set up.
    StorageModule,
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
    //
    // SINGLE-INSTANCE. The default storage is this process's memory, so every
    // limit below is per replica and resets on restart. Running two of these
    // doubles each ceiling — the per-route numbers are chosen assuming one — so
    // horizontal scaling needs a shared store first, the way `SESSION_STORE`
    // already names its swap.
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
    // Three flow services rather than one: signing in, registering, and
    // recovering share hashing, mailing and address folding — the three
    // collaborators above them — and nothing else. Splitting them is what keeps
    // each flow's reasoning next to the flow instead of in one file nobody reads
    // top to bottom.
    AuthService,
    RegistrationService,
    PasswordResetService,
    PasswordHasher,
    AuthMailer,
    GoogleTokenVerifier,
    PurposeTokenService,
    // Exported so a transport can register with it. AuthService injects it to
    // end a user's live connections when their password changes; the transport
    // that actually holds sockets registers itself from the other side.
    SessionTerminator,
    { provide: AUTH_ADAPTER, useClass: JwtAuthAdapter },
    // Registered HERE, not in CommonModule. CommonModule has no `imports` and
    // AuthModule is not @Global, so a guard registered there could never
    // resolve AUTH_ADAPTER. Registering it in the module that owns the token
    // keeps auth's DI surface narrow instead of making it global.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  exports: [AUTH_ADAPTER, AuthService, SessionTerminator],
})
export class AuthModule {}
