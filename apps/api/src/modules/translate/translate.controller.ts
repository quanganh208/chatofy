import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import type { TranslationHints, TtsVoice } from '@chatofy/ai-providers';
import { languageCodeSchema, type TranslateResponse } from '@chatofy/types';
import { ApiEnvelopeResponse } from '../../common/swagger/api-envelope-response.helper';
import { ApiErrorResponses } from '../../common/swagger/api-error-response.helper';
import { GlossaryService } from '../glossary/glossary.service';
import { TranslateRequestDto, TranslateResponseDto } from './dto/translate.dto';
import { VoicesResponseDto } from './dto/voices.dto';
import { PipelineTranslatorService } from './services/pipeline-translator.service';

/**
 * Turn-based translation endpoint. Accepts a complete audio utterance (base64)
 * plus a direction, returns the transcript, the translation, and synthesized
 * speech in the target language.
 *
 * Directions: vi→en and en→vi. The raw payload is wrapped by
 * TransformInterceptor.
 *
 * Authenticated, despite what this comment used to say: `JwtAuthGuard` is
 * registered as a global `APP_GUARD` and nothing here is marked `@Public()`, so
 * every route on this controller requires a bearer token.
 */
@ApiTags('translate')
@Controller('translate')
export class TranslateController {
  constructor(
    private readonly pipeline: PipelineTranslatorService,
    private readonly glossary: GlossaryService,
  ) {}

  /**
   * `@ApiBearerAuth()` is written per route here, not on the class, for the same
   * reason `@Public()` is: a class-level mark is inherited silently, and the
   * next route added would then claim an authentication requirement nobody
   * chose for it. It is documentation only — the guard is global — so being
   * explicit costs one line and keeps the padlock honest.
   */
  @Post()
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Translate an audio utterance to speech in the target language',
    description:
      'Send a complete utterance as base64 audio plus a direction (`vi_to_en` or `en_to_vi`). Answers with the transcript, the translation, and synthesized speech in the target language. The body carries audio, so it is large — the JSON body limit is 12 MB, and anything longer than a short utterance belongs on the WebSocket surface instead.',
  })
  @ApiEnvelopeResponse(TranslateResponseDto)
  @ApiErrorResponses(400, 401)
  async translate(
    @Req() req: Request,
    @Body() body: TranslateRequestDto,
  ): Promise<TranslateResponse> {
    const audio = Buffer.from(body.audioBase64, 'base64');
    if (audio.length === 0) {
      throw new BadRequestException(
        'audioBase64 did not decode to any audio bytes',
      );
    }
    return this.pipeline.translateTurn({
      audio: new Uint8Array(audio),
      mimeType: body.audioMimeType,
      direction: body.direction,
      voiceGender: body.voiceGender,
      speed: body.speed,
      // The caller's saved glossary, loaded from the verified token's subject —
      // never from the body, the same anti-escalation rule the WS path follows.
      // Omitted when empty so an account with no glossary sends the exact prompt
      // it did before this feature. This is the one-shot REST path, so the load
      // is per request; the streaming path caches it per socket instead.
      ...(await this.glossaryHints(req.auth!.userId)),
    });
  }

  /** `{ hints }` with the caller's glossary as terms, or `{}` when they have none. */
  private async glossaryHints(
    ownerId: string,
  ): Promise<{ hints?: TranslationHints }> {
    const terms = await this.glossary.list(ownerId);
    if (!terms.length) return {};
    return {
      hints: {
        terms: terms.map((t) => ({
          vi: t.vi,
          en: t.en,
          keepVerbatim: t.keepVerbatim,
        })),
      },
    };
  }

  /**
   * Voices the running speech backend offers for a language.
   *
   * Answered from the backend itself rather than from a list kept here, because
   * which voices exist is a property of whatever is deployed. A client that
   * hardcoded them would be wrong the day `AI_TTS_PROVIDER` changed — and that is
   * not hypothetical: a voice name meant for one backend once reached another and
   * took Vietnamese synthesis down entirely.
   *
   * An empty list is a real answer, meaning "this backend offers no choice", and
   * a client should show gender alone. It is NOT the same as this call failing,
   * and a caller must not collapse the two — a 401 or a stopped sidecar would
   * then be indistinguishable from a backend that simply has one voice.
   */
  @Get('voices')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List the voices the running TTS backend offers',
    description:
      'Answered from the backend itself, not from a list kept in the API, because which voices exist is a property of whatever is deployed. Do not hardcode `token` values — they are opaque and change with the backend. An empty list means this backend offers no choice; show gender alone. That is a successful answer, not a failure.',
  })
  @ApiQuery({
    name: 'language',
    required: false,
    enum: ['vi', 'en'],
    description: 'Which language to list voices for. Defaults to `en`.',
  })
  @ApiEnvelopeResponse(VoicesResponseDto)
  @ApiErrorResponses(400, 401)
  async voices(
    @Query('language') language?: string,
  ): Promise<{ voices: TtsVoice[] }> {
    const parsed = languageCodeSchema.safeParse(language ?? 'en');
    if (!parsed.success) {
      throw new BadRequestException('language must be "vi" or "en"');
    }
    return { voices: await this.pipeline.listVoices(parsed.data) };
  }
}
