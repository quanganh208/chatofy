import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AuthSession } from '@chatofy/types';
import type { Request } from 'express';
import { ApiEnvelopeResponse } from '../../common/swagger/api-envelope-response.helper';
import { ApiErrorResponses } from '../../common/swagger/api-error-response.helper';
import { AuthSessionDto, ChangePasswordRequestDto } from './dto/auth.dto';
import { PasswordChangeService } from './password-change.service';
import { UserThrottlerGuard } from './user-throttler.guard';

/**
 * Changing the signed-in caller's password.
 *
 * ITS OWN CONTROLLER because of the throttle key. `AuthController` mounts the
 * stock `ThrottlerGuard`, which counts per client address, and a guard on a class
 * applies to every route in it — so this route there would be counted per IP as
 * well, and every web user would share the Next server's one allowance.
 */
@ApiTags('auth')
@Controller('auth')
@UseGuards(UserThrottlerGuard)
export class PasswordChangeController {
  constructor(private readonly passwords: PasswordChangeService) {}

  /**
   * Guarded — it carries no `@Public()` — and scoped to the CALLER's own row: the
   * id comes from the verified token, and `ChangePasswordRequestDto` has no field
   * that could name another.
   *
   * Five a minute PER USER. Each call spends two argon2 operations, and the limit
   * is what bounds guessing the current password with a stolen access token.
   *
   * 200 WITH a session, unlike `reset-password`. Every credential issued before
   * this call is revoked, the caller's included; the caller has just proved both
   * the session and the current password, so it gets the replacement here instead
   * of being sent back to the sign-in form.
   */
  @Post('change-password')
  @HttpCode(200)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: "Change the caller's password; signs out every other device",
  })
  @ApiEnvelopeResponse(AuthSessionDto, {
    description:
      'The password was changed. Every token, refresh token and socket issued before now is revoked, including the one used for this call, so replace them with the session returned here.',
  })
  @ApiErrorResponses(400, 401, 403, 409, 429)
  changePassword(
    @Req() req: Request,
    @Body() body: ChangePasswordRequestDto,
  ): Promise<AuthSession> {
    return this.passwords.changePassword(req.auth!.userId, body);
  }
}
