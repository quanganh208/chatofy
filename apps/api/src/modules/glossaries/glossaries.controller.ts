import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import type {
  GlossaryItemListResponse,
  GlossaryListResponse,
} from '@chatofy/types';
import { ApiEnvelopeResponse } from '../../common/swagger/api-envelope-response.helper';
import { ApiErrorResponses } from '../../common/swagger/api-error-response.helper';
import {
  GlossaryIdParamDto,
  GlossaryItemListResponseDto,
  GlossaryItemResponseDto,
  GlossaryListResponseDto,
  GlossaryResponseDto,
  ItemIdParamDto,
  PatchGlossaryRequestDto,
  SaveGlossaryItemRequestDto,
  SaveGlossaryRequestDto,
} from './dto/glossaries.dto';
import { GlossariesService } from './glossaries.service';

@ApiTags('glossaries')
@Controller('glossaries')
@UseGuards(ThrottlerGuard)
export class GlossariesController {
  constructor(private readonly glossaries: GlossariesService) {}

  @Get()
  @ApiBearerAuth()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: "List the caller's glossaries, newest first" })
  @ApiEnvelopeResponse(GlossaryListResponseDto)
  @ApiErrorResponses(401, 429)
  async list(@Req() req: Request): Promise<GlossaryListResponse> {
    return {
      glossaries: await this.glossaries.listGlossaries(req.auth!.userId),
    };
  }

  @Put(':glossaryId')
  @ApiBearerAuth()
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Create or update a glossary',
    description:
      'PUT: the client mints the id. 409 when the account is at the glossary limit and this id is new.',
  })
  @ApiEnvelopeResponse(GlossaryResponseDto)
  @ApiErrorResponses(400, 401, 409, 429)
  async save(
    @Req() req: Request,
    @Param() params: GlossaryIdParamDto,
    @Body() body: SaveGlossaryRequestDto,
  ) {
    return {
      glossary: await this.glossaries.saveGlossary(
        req.auth!.userId,
        params.glossaryId,
        body,
      ),
    };
  }

  @Patch(':glossaryId')
  @ApiBearerAuth()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Toggle active state or set as default',
    description:
      'Setting isDefault: true clears the previous default atomically on the server.',
  })
  @ApiEnvelopeResponse(GlossaryResponseDto)
  @ApiErrorResponses(400, 401, 404, 429)
  async patch(
    @Req() req: Request,
    @Param() params: GlossaryIdParamDto,
    @Body() body: PatchGlossaryRequestDto,
  ) {
    return {
      glossary: await this.glossaries.patchGlossary(
        req.auth!.userId,
        params.glossaryId,
        body,
      ),
    };
  }

  @Delete(':glossaryId')
  @ApiBearerAuth()
  @HttpCode(204)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Delete a glossary and all its terms' })
  @ApiErrorResponses(400, 401, 429)
  async remove(
    @Req() req: Request,
    @Param() params: GlossaryIdParamDto,
  ): Promise<void> {
    await this.glossaries.removeGlossary(req.auth!.userId, params.glossaryId);
  }

  @Get(':glossaryId/items')
  @ApiBearerAuth()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'List terms in a glossary' })
  @ApiEnvelopeResponse(GlossaryItemListResponseDto)
  @ApiErrorResponses(400, 401, 429)
  async listItems(
    @Req() req: Request,
    @Param() params: GlossaryIdParamDto,
  ): Promise<GlossaryItemListResponse> {
    return {
      items: await this.glossaries.listItems(
        req.auth!.userId,
        params.glossaryId,
      ),
    };
  }

  @Post(':glossaryId/items')
  @ApiBearerAuth()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Add a term pair to a glossary',
    description:
      'clientId in the body provides idempotency — retrying with the same clientId returns the existing row.',
  })
  @ApiEnvelopeResponse(GlossaryItemResponseDto)
  @ApiErrorResponses(400, 401, 409, 429)
  async addItem(
    @Req() req: Request,
    @Param() params: GlossaryIdParamDto,
    @Body() body: SaveGlossaryItemRequestDto,
  ) {
    return {
      item: await this.glossaries.addItem(
        req.auth!.userId,
        params.glossaryId,
        body,
      ),
    };
  }

  @Delete(':glossaryId/items/:itemId')
  @ApiBearerAuth()
  @HttpCode(204)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Delete one term from a glossary' })
  @ApiErrorResponses(400, 401, 429)
  async removeItem(
    @Req() req: Request,
    @Param() params: ItemIdParamDto,
  ): Promise<void> {
    await this.glossaries.removeItem(
      req.auth!.userId,
      params.glossaryId,
      params.itemId,
    );
  }
}
