import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { TranslateResponse } from '@chatofy/types';
import { ApiEnvelopeResponse } from '../../common/swagger/api-envelope-response.helper';
import { TranslateRequestDto, TranslateResponseDto } from './dto/translate.dto';
import { PipelineTranslatorService } from './services/pipeline-translator.service';

/**
 * Turn-based translation endpoint. Accepts a complete audio utterance (base64)
 * plus a direction, returns the transcript, the translation, and synthesized
 * speech in the target language.
 *
 * Directions: vi→en and en→vi. No auth. The raw payload is
 * wrapped by TransformInterceptor.
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
    });
  }
}
