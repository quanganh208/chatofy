import { Module } from '@nestjs/common';
import { TRANSLATOR_SERVICE } from './interfaces/translator-service.interface';
import { NoopTranslatorService } from './services/noop-translator.service';
import { TranslateGateway } from './translate.gateway';

/**
 * Translate module — binds TRANSLATOR_SERVICE token to NoopTranslatorService.
 * Replace with a real provider (OpenAI Realtime, Google STT, etc.) via the token.
 */
@Module({
  providers: [
    TranslateGateway,
    {
      provide: TRANSLATOR_SERVICE,
      useClass: NoopTranslatorService,
    },
  ],
})
export class TranslateModule {}
