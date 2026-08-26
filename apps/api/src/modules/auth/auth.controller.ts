import {
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { AuthMessage, AuthSession, User } from '@chatofy/types';
import type { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { ApiEnvelopeResponse } from '../../common/swagger/api-envelope-response.helper';
import { ApiErrorResponses } from '../../common/swagger/api-error-response.helper';
import { AuthService } from './auth.service';
import { RegistrationService } from './registration.service';
import { PasswordResetService } from './password-reset.service';
import {
  AuthMessageDto,
  AuthSessionDto,
  ForgotPasswordRequestDto,
  GoogleLoginRequestDto,
  LoginRequestDto,
  RegisterRequestDto,
  ResetPasswordRequestDto,
  UpdateMeRequestDto,
  UserDto,
  VerifyEmailRequestDto,
} from './dto/auth.dto';

/**
 * Password identity: create an account, exchange credentials for an access
 * token, and read back who a token belongs to.
 *
 * Register and login are unauthenticated by necessity and each spends a full
 * argon2 hash — 64 MiB on the libuv threadpool, which this process shares with
 * the translate pipeline's file and crypto work. The per-route throttles below
 * are what keeps an attacker's chosen request rate from deciding how much of
 * that pool auth gets.
 */
@ApiTags('auth')
@Controller('auth')
@UseGuards(ThrottlerGuard)
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly registration: RegistrationService,
    private readonly reset: PasswordResetService,
  ) {}

  /**
   * 202, not 201, and the same 202 for an address that already has an account.
   *
   * Nothing is created here — registration is accepted and finishes when the
   * mailed link is followed — so 201 would name a resource that does not exist.
   * The uniformity is the security property: see `RegistrationService.register`.
   */
  @Post('register')
  @Public()
  @HttpCode(202)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Begin registration; sends a verification link' })
  @ApiEnvelopeResponse(AuthMessageDto, {
    status: 202,
    description:
      'Accepted. No account exists yet — it is created when the mailed link is followed. Answered identically for an address that already has one, so this says nothing about whether it does.',
  })
  @ApiErrorResponses(400, 429)
  register(@Body() body: RegisterRequestDto): Promise<AuthMessage> {
    return this.registration.register(body);
  }

  /** Redeems a verification link. This is what creates the account. */
  @Post('verify-email')
  @Public()
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Redeem a verification link and create the account',
  })
  @ApiEnvelopeResponse(AuthMessageDto)
  @ApiErrorResponses(400, 429)
  verifyEmail(@Body() body: VerifyEmailRequestDto): Promise<AuthMessage> {
    return this.registration.verifyEmail(body);
  }

  /**
   * Answers 202 for every address, known or not, and sends its mail detached —
   * so neither the status, the body, nor the response time says whether an
   * account exists. Throttled harder than the rest: it is the one route whose
   * whole job is to send mail to an address the caller names.
   */
  @Post('forgot-password')
  @Public()
  @HttpCode(202)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Send a password reset link, if the account exists',
  })
  @ApiEnvelopeResponse(AuthMessageDto, {
    status: 202,
    description:
      'Accepted. Returned for every address, known or not, with the mail sent detached — neither this status, the body, nor the response time reveals whether an account exists.',
  })
  @ApiErrorResponses(400, 429)
  forgotPassword(@Body() body: ForgotPasswordRequestDto): Promise<AuthMessage> {
    return this.reset.forgotPassword(body);
  }

  /**
   * 200 with NO session. Completing a reset invalidates the tokens issued before
   * it, so handing back a fresh one here would be the one credential exempt from
   * the rule — and the person doing this has just proved they can type the new
   * password, so signing in is one step away.
   */
  @Post('reset-password')
  @Public()
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Redeem a reset link and set a new password' })
  @ApiEnvelopeResponse(AuthMessageDto, {
    description:
      'The password was changed. Deliberately carries NO session: completing a reset invalidates the tokens issued before it, so sign in again.',
  })
  @ApiErrorResponses(400, 429)
  resetPassword(@Body() body: ResetPasswordRequestDto): Promise<AuthMessage> {
    return this.reset.resetPassword(body);
  }

  @Post('login')
  @Public()
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Exchange email and password for a session' })
  @ApiEnvelopeResponse(AuthSessionDto)
  @ApiErrorResponses(400, 401, 429)
  login(@Body() body: LoginRequestDto): Promise<AuthSession> {
    return this.auth.login(body);
  }

  /**
   * Verified server-side against Google's JWKS. The client hands over the
   * id_token it was issued and nothing else — an access_token would prove
   * nothing about identity, and trusting a client-decoded payload would let
   * anyone sign in as anyone.
   */
  @Post('google')
  @Public()
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Exchange a Google id_token for a session' })
  @ApiEnvelopeResponse(AuthSessionDto)
  @ApiErrorResponses(400, 401, 429)
  google(@Body() body: GoogleLoginRequestDto): Promise<AuthSession> {
    return this.auth.loginWithGoogle(body.idToken);
  }

  /**
   * Guarded, unlike the three above — it simply carries no @Public(). This is why
   * that decorator is never applied at controller granularity: a class-level
   * mark would ship this route open, and nothing written here would say so.
   *
   * The web session shell calls it to hydrate a session and to tell an auth
   * failure apart from a network fault, so it must answer 401 for a token that
   * is missing, expired or forged.
   */
  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: "The authenticated caller's profile" })
  @ApiEnvelopeResponse(UserDto)
  @ApiErrorResponses(401)
  me(@Req() req: Request): Promise<User> {
    return this.auth.findMe(req.auth!.userId);
  }

  /**
   * Changes the language this account's mail is written in.
   *
   * Guarded like `GET /auth/me` and scoped to the CALLER's own row — the id comes
   * from the verified token, never from the body. There is no user id in
   * `UpdateMeRequestDto` and there must not be: a field naming whose row to change
   * turns a settings endpoint into a horizontal-privilege escalation, and the safest
   * way to guarantee it is absent is to have no field for it.
   *
   * Strict about the value, unlike register and forgot-password, which coerce. Those
   * two answer identically for any address and must not let a bad `locale` produce a
   * different status code; this one is called by someone changing their own setting,
   * so a 400 on nonsense tells the caller something true and leaks nothing.
   */
  @Patch('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: "Update the authenticated caller's settings" })
  @ApiEnvelopeResponse(UserDto)
  @ApiErrorResponses(400, 401)
  updateMe(
    @Req() req: Request,
    @Body() dto: UpdateMeRequestDto,
  ): Promise<User> {
    return this.auth.updateMe(req.auth!.userId, dto);
  }
}
