import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { TranslateResponse } from '@chatofy/types';
import { ApiEnvelopeResponse } from '../../common/swagger/api-envelope-response.helper';
import { TranslateRequestDto, TranslateResponseDto } from './dto/translate.dto';
import { PipelineTranslatorService } from './services/pipeline-translator.service';

/**
 * Turn-based translation endpoint. Accepts a complete Vietnamese audio utterance
 * (base64) plus a speed↔quality value, returns the transcript, English
 * translation, and synthesized English audio.
 *
 * V1: vi→en only, no auth. The raw payload is wrapped by TransformInterceptor.
 */
@ApiTags('translate')
@Controller('translate')
export class TranslateController {
  constructor(private readonly pipeline: PipelineTranslatorService) {}

  @Post()
  @ApiOperation({
    summary: 'Translate a Vietnamese audio utterance to English speech',
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
      quality: body.quality,
    });
  }
}
