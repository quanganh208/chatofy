import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { AuthMessage, AuthSession, AuthToken, User } from '@chatofy/types';
import type { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { ApiEnvelopeResponse } from '../../common/swagger/api-envelope-response.helper';
import { ApiErrorResponses } from '../../common/swagger/api-error-response.helper';
import { AuthService } from './auth.service';
import { RegistrationService } from './registration.service';
import { PasswordResetService } from './password-reset.service';
import { SessionRefreshService } from './session-refresh.service';
import {
  AuthMessageDto,
  AuthSessionDto,
  AuthTokenDto,
  ForgotPasswordRequestDto,
  GoogleLoginRequestDto,
  LoginRequestDto,
  RefreshRequestDto,
  RegisterRequestDto,
  ResetPasswordRequestDto,
  RevokeRequestDto,
  UpdateMeRequestDto,
  UploadAvatarRequestDto,
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
    private readonly refreshFlow: SessionRefreshService,
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
   * Renews a session silently, before the fifteen-minute access token elapses.
   *
   * @Public() by necessity, exactly like login: the access token this renews may
   * already be expired, so requiring one would make the route unreachable at the
   * moment it is needed. The refresh token IS the credential, and it is
   * one-time-use — presenting a spent one outside the rotation grace window
   * revokes the whole family and closes that user's live sockets.
   *
   * THE LIMIT IS HIGH ON PURPOSE, and the reason is stronger than it first
   * looks. The throttler keys on the client IP, and for the two callers that
   * matter that key is NOT one user:
   *
   * - **Web is the worst case: one address for everybody.** The renewal runs
   *   inside the Auth.js `jwt` callback, which executes on the NEXT SERVER, so
   *   every web user's renewal arrives from a single origin. A per-user-sized
   *   limit here would be a global cap.
   * - **The extension calls from the browser**, where `TRUST_PROXY_HOPS=1` makes
   *   the key a carrier CGNAT address shared by thousands of mobile users, or
   *   one office NAT.
   *
   * The failure mode is the bad one either way: a 429 is not a 401, so a client
   * classifies it transient, keeps its stale token, and stops being able to
   * renew while still appearing signed in — verbatim the symptom this route
   * exists to remove. Per-replica too (see auth.module.ts), which is another
   * reason not to set it tight. Tracking per family rather than per IP is the
   * real fix and needs a custom tracker; the high IP limit is the stand-in.
   *
   * 503, not 500 and never 401, when the token store is unreachable — a 401
   * would be read by every client as proof the session is dead.
   */
  @Post('refresh')
  @Public()
  @HttpCode(200)
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @ApiOperation({ summary: 'Trade a refresh token for a fresh token pair' })
  @ApiEnvelopeResponse(AuthTokenDto, {
    description:
      'A new access token and a NEW refresh token — the one presented is now spent. Carries no profile: a renewal must not overwrite a locally edited one.',
  })
  @ApiErrorResponses(400, 401, 429, 503)
  refresh(@Body() body: RefreshRequestDto): Promise<AuthToken> {
    return this.refreshFlow.refresh(body.refreshToken);
  }

  /**
   * Sign-out, server-side. Ends this browser's refresh family.
   *
   * 204 WHETHER OR NOT THE TOKEN MATCHED, deliberately: an unknown token and a
   * just-revoked one are indistinguishable to the caller, so this is not an
   * oracle for "is this token still live", and someone leaving is never blocked
   * by a failure they could not act on. A Redis outage is swallowed for the same
   * reason — the client clears its own state regardless.
   *
   * It does NOT close sockets. Signing out of one browser must not drop the
   * user's meeting on another device; that is what separates a voluntary
   * sign-out from detected theft.
   *
   * Still not sign-out-everywhere: other devices hold their own families, and
   * the access token already issued runs out its remaining minutes.
   *
   * Limited like `refresh`, NOT like `login`, and for the reason spelled out
   * there: the web caller is the Next server, so every web sign-out arrives
   * from one address. At a login-sized limit this would be a global cap on
   * signing out — and because a failed revoke is deliberately swallowed by the
   * client (a person leaving must not be blocked), the family would silently
   * survive. That would quietly undo the whole point of this route.
   */
  @Post('revoke')
  @Public()
  @HttpCode(204)
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @ApiOperation({ summary: "End this browser's refresh family on sign-out" })
  @ApiErrorResponses(400, 429)
  async revoke(@Body() body: RevokeRequestDto): Promise<void> {
    await this.refreshFlow.revoke(body.refreshToken);
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

  /**
   * Replaces the caller's avatar with the image in the body.
   *
   * Scoped to the CALLER's own row for the same reason `PATCH /auth/me` is: the
   * id comes from the verified token and `UploadAvatarRequestDto` has no field
   * that could name a different one.
   *
   * Throttled explicitly rather than inheriting the module's 60/min. Note the
   * precedent honestly — `PATCH /auth/me` above carries no throttle at all, so
   * it is not true that every mutating route here is limited. But that route's
   * body is two characters and it performs no network write; this one accepts
   * the largest bodies in the controller and issues billable writes to an object
   * store, so the module default is the wrong ceiling for it.
   *
   * 409 rather than 503 when storage is unconfigured: `ApiErrorResponses` throws
   * at import for any status outside its table, and `all-exceptions.filter.ts`
   * replaces every 5xx message — so a 503 could not tell a client anything a
   * crash does not. A 4xx keeps its message, which is what makes the failure
   * diagnosable.
   */
  @Put('me/avatar')
  @ApiBearerAuth()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: "Replace the authenticated caller's avatar" })
  @ApiEnvelopeResponse(UserDto)
  @ApiErrorResponses(400, 401, 409, 429)
  setAvatar(
    @Req() req: Request,
    @Body() dto: UploadAvatarRequestDto,
  ): Promise<User> {
    return this.auth.setAvatar(req.auth!.userId, dto.image);
  }

  /**
   * Removes the caller's avatar — the object first, the columns only after.
   *
   * A takedown, not a dereference. The bucket is public-read, so clearing the
   * column while the object survives would leave a photograph published after
   * its owner asked for it to be removed, and the owner was told 200. When the
   * object cannot be deleted the columns are left as they were and the caller
   * gets a retryable 409.
   */
  @Delete('me/avatar')
  @ApiBearerAuth()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: "Remove the authenticated caller's avatar" })
  @ApiEnvelopeResponse(UserDto)
  @ApiErrorResponses(401, 409, 429)
  removeAvatar(@Req() req: Request): Promise<User> {
    return this.auth.removeAvatar(req.auth!.userId);
  }
}
