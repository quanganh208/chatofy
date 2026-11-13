import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { UserThrottlerGuard } from '../auth/user-throttler.guard';
import type { Request } from 'express';
import type { PreferencesResponse } from '@chatofy/types';
import { ApiEnvelopeResponse } from '../../common/swagger/api-envelope-response.helper';
import { ApiErrorResponses } from '../../common/swagger/api-error-response.helper';
import {
  PreferencesResponseDto,
  UpdatePreferencesRequestDto,
} from './dto/preferences.dto';
import { PreferencesService } from './preferences.service';

/**
 * The signed-in account's preferences, one document shared by web, mobile and
 * the extension.
 *
 * Authenticated: `JwtAuthGuard` is a global `APP_GUARD` and nothing here is
 * `@Public()`. A throttle is applied here because there is no global throttle in
 * this app — a route that does not ask for a limit has none. It counts per
 * ACCOUNT (`UserThrottlerGuard`), not per address: every client reads this on
 * focus, so a per-IP cap would be shared by everyone behind one office NAT, and by
 * the whole web user base behind the Next server.
 *
 * The owner is `req.auth!.userId` on every route, never a path or body field.
 */
@ApiTags('preferences')
@Controller('me/preferences')
@UseGuards(UserThrottlerGuard)
export class PreferencesController {
  constructor(private readonly preferences: PreferencesService) {}

  @Get()
  @ApiBearerAuth()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({
    summary: "Read the caller's preferences",
    description:
      'Always a whole document. An account that never saved anything gets the defaults derived from its locale, with `updatedAt: null`. A stored field this build cannot read falls back to its default on its own; the rest of the document is unaffected. Clients read this on start and on focus or foreground — there is no push.',
  })
  @ApiEnvelopeResponse(PreferencesResponseDto)
  @ApiErrorResponses(401, 429)
  get(@Req() req: Request): Promise<PreferencesResponse> {
    return this.preferences.get(req.auth!.userId);
  }

  @Patch()
  @ApiBearerAuth()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Change some preferences',
    description:
      'A partial document merged over the stored one: scalars replace, `call`, `pairs` and `reading` merge one level, and `voices` merges per language and then per field. `null` on `contextId` or `conferenceLanguage` sets it to null. The merged result must be a valid document under 16 KiB serialized, or nothing is written and the answer is 400. Concurrent patches from two devices are applied one after the other, so a field one of them did not send is never lost. Answers with the whole stored document.',
  })
  @ApiEnvelopeResponse(PreferencesResponseDto)
  @ApiErrorResponses(400, 401, 429)
  update(
    @Req() req: Request,
    @Body() body: UpdatePreferencesRequestDto,
  ): Promise<PreferencesResponse> {
    return this.preferences.update(req.auth!.userId, body.preferences);
  }

  @Delete()
  @ApiBearerAuth()
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Reset preferences to defaults',
    description:
      'Empties the stored document and answers with the defaults. `updatedAt` moves forward (it is the version clients compare), so it is never null after a reset. Repeating it gives the same document.',
  })
  @ApiEnvelopeResponse(PreferencesResponseDto)
  @ApiErrorResponses(401, 429)
  reset(@Req() req: Request): Promise<PreferencesResponse> {
    return this.preferences.reset(req.auth!.userId);
  }
}
