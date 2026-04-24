import { Module } from '@nestjs/common';
import { TRANSLATOR_SERVICE } from './interfaces/translator-service.interface.js';
import { NoopTranslatorService } from './services/noop-translator.service.js';
import { TranslateGateway } from './translate.gateway.js';

/**
 * Translate module — hosts the WebSocket gateway and translator service DI binding.
 * Swap TRANSLATOR_SERVICE useClass to a real provider when AI_REALTIME_PROVIDER is set.
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
