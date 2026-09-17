import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import type { TranslationContextListResponse } from '@chatofy/types';
import { ApiEnvelopeResponse } from '../../common/swagger/api-envelope-response.helper';
import { ApiErrorResponses } from '../../common/swagger/api-error-response.helper';
import {
  SaveTranslationContextRequestDto,
  TranslationContextIdParamDto,
  TranslationContextListResponseDto,
  TranslationContextResponseDto,
} from './dto/translation-contexts.dto';
import { TranslationContextsService } from './translation-contexts.service';

/**
 * A signed-in user's AI Context library.
 *
 * Authenticated: `JwtAuthGuard` is a global `APP_GUARD` and nothing here is
 * `@Public()`, so every route requires a bearer token. `@ApiBearerAuth()` is
 * per-route documentation only, as on the other controllers.
 *
 * `ThrottlerGuard` is applied HERE and not inherited: there is no global throttle
 * in this app — the only `APP_GUARD` is `JwtAuthGuard` — so a route that does not
 * ask for a limit does not have one.
 *
 * The owner is `req.auth!.userId` on every route and is never read from a path
 * or body field, which is the same anti-escalation discipline `PATCH /auth/me`
 * documents.
 */
@ApiTags('translation-contexts')
@Controller('translation-contexts')
@UseGuards(ThrottlerGuard)
export class TranslationContextsController {
  constructor(private readonly contexts: TranslationContextsService) {}

  @Get()
  @ApiBearerAuth()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({
    summary: "List the caller's saved AI Contexts, newest first",
    description:
      'Unpaged, because the library is bounded at 20 rows per account — a cursor here would be machinery for a page that can never exist. Both the web editor and the extension popup read this same list; authoring happens only on web.',
  })
  @ApiEnvelopeResponse(TranslationContextListResponseDto)
  @ApiErrorResponses(401, 429)
  async list(@Req() req: Request): Promise<TranslationContextListResponse> {
    return { contexts: await this.contexts.list(req.auth!.userId) };
  }

  @Put(':contextId')
  @ApiBearerAuth()
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Save or replace one AI Context',
    description:
      'PUT rather than POST: the client mints the id and sends the whole context, so the write is a full, idempotent replacement — including the glossary, which is deleted and re-created rather than merged, so a shorter re-save cannot leave a stale tail of pairs. 409 when the account already holds the maximum and this id is not one of them; a replace of an existing context is always allowed, or a full library would be uneditable.',
  })
  @ApiEnvelopeResponse(TranslationContextResponseDto)
  @ApiErrorResponses(400, 401, 409, 429)
  async save(
    @Req() req: Request,
    @Param() params: TranslationContextIdParamDto,
    @Body() body: SaveTranslationContextRequestDto,
  ) {
    return {
      context: await this.contexts.save(
        req.auth!.userId,
        params.contextId,
        body,
      ),
    };
  }

  @Delete(':contextId')
  @ApiBearerAuth()
  @HttpCode(204)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Delete one AI Context',
    description:
      'Idempotent: 204 whether a row went or not, so an id that never existed and one belonging to another account are indistinguishable. The glossary goes with it through the relation cascade. A conversation already running under this context is unaffected — the client resolved its hints when the session started.',
  })
  @ApiErrorResponses(400, 401, 429)
  async remove(
    @Req() req: Request,
    @Param() params: TranslationContextIdParamDto,
  ): Promise<void> {
    await this.contexts.remove(req.auth!.userId, params.contextId);
  }
}
