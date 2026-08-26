import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { TtsVoice } from '@chatofy/ai-providers';
import { languageCodeSchema, type TranslateResponse } from '@chatofy/types';
import { ApiEnvelopeResponse } from '../../common/swagger/api-envelope-response.helper';
import { TranslateRequestDto, TranslateResponseDto } from './dto/translate.dto';
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
  constructor(private readonly pipeline: PipelineTranslatorService) {}

  @Post()
  @ApiOperation({
    summary: 'Translate an audio utterance to speech in the target language',
  })
  @ApiEnvelopeResponse(TranslateResponseDto)
  async translate(
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
    });
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
  @ApiOperation({ summary: 'List the voices the running TTS backend offers' })
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
