import { Module } from '@nestjs/common';
import { TRANSLATOR_SERVICE } from './interfaces/translator-service.interface';
import { AiProvidersFactory } from './providers/ai-providers.factory';
import { NoopTranslatorService } from './services/noop-translator.service';
import { PipelineTranslatorService } from './services/pipeline-translator.service';
import { TranslateController } from './translate.controller';
import { TranslateGateway } from './translate.gateway';

/**
 * Translate module.
 *
 * - REST: POST /translate → TranslateController → PipelineTranslatorService
 *   (ElevenLabs STT/TTS + Gemini translation via AiProvidersFactory).
 * - WS: TranslateGateway is still stubbed; TRANSLATOR_SERVICE stays bound to
 *   NoopTranslatorService until the streaming path is implemented.
 */
@Module({
  controllers: [TranslateController],
  providers: [
    TranslateGateway,
    AiProvidersFactory,
    PipelineTranslatorService,
    {
      provide: TRANSLATOR_SERVICE,
      useClass: NoopTranslatorService,
    },
  ],
})
export class TranslateModule {}
