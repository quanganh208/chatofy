import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type {
  GlossaryListResponse,
  GlossaryTermResponse,
} from '@chatofy/types';
import { ApiEnvelopeResponse } from '../../common/swagger/api-envelope-response.helper';
import { ApiErrorResponses } from '../../common/swagger/api-error-response.helper';
import {
  CreateGlossaryTermRequestDto,
  GlossaryListResponseDto,
  GlossaryTermResponseDto,
  ImportGlossaryRequestDto,
  UpdateGlossaryTermRequestDto,
} from './dto/glossary.dto';
import { GlossaryService } from './glossary.service';

/**
 * Glossary management endpoints for the authenticated caller.
 *
 * The glossary is a per-user set of domain term pairs applied to that user's
 * translations; these routes manage it. The translation path does NOT read a
 * client-sent glossary — the server loads the caller's saved glossary itself —
 * so a term pair can only ever be established here, behind auth.
 *
 * Authenticated: `JwtAuthGuard` is a global `APP_GUARD` and nothing here is
 * `@Public()`, so every route requires a bearer token. The owner is always the
 * verified token's subject (`req.auth!.userId`), never a path or body value —
 * the same anti-escalation discipline the minutes controller documents.
 */
@ApiTags('glossary')
@Controller('glossary')
export class GlossaryController {
  constructor(private readonly glossary: GlossaryService) {}

  @Get('terms')
  @ApiBearerAuth()
  @ApiOperation({ summary: "List the caller's glossary terms" })
  @ApiEnvelopeResponse(GlossaryListResponseDto)
  @ApiErrorResponses(401)
  async list(@Req() req: Request): Promise<GlossaryListResponse> {
    return { terms: await this.glossary.list(req.auth!.userId) };
  }

  @Post('terms')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Add one glossary term' })
  @ApiEnvelopeResponse(GlossaryTermResponseDto, { status: 201 })
  @ApiErrorResponses(400, 401, 409)
  async create(
    @Req() req: Request,
    @Body() body: CreateGlossaryTermRequestDto,
  ): Promise<GlossaryTermResponse> {
    return { term: await this.glossary.create(req.auth!.userId, body) };
  }

  @Patch('terms/:id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update one glossary term' })
  @ApiEnvelopeResponse(GlossaryTermResponseDto)
  @ApiErrorResponses(400, 401, 404, 409)
  async update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: UpdateGlossaryTermRequestDto,
  ): Promise<GlossaryTermResponse> {
    return { term: await this.glossary.update(req.auth!.userId, id, body) };
  }

  @Delete('terms/:id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete one glossary term' })
  @ApiEnvelopeResponse(GlossaryTermResponseDto)
  @ApiErrorResponses(401, 404)
  async remove(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<GlossaryTermResponse> {
    return { term: await this.glossary.remove(req.auth!.userId, id) };
  }

  @Post('import')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Bulk-import terms into the caller's glossary",
    description:
      'Rows arrive already parsed into `{ vi, en, keepVerbatim }` terms (the client owns CSV parsing). `mode: "merge"` upserts each pair into the existing glossary; `mode: "replace"` overwrites the whole glossary. Answers with the resulting glossary.',
  })
  @ApiEnvelopeResponse(GlossaryListResponseDto)
  @ApiErrorResponses(400, 401, 409)
  async import(
    @Req() req: Request,
    @Body() body: ImportGlossaryRequestDto,
  ): Promise<GlossaryListResponse> {
    return { terms: await this.glossary.import(req.auth!.userId, body) };
  }
}
