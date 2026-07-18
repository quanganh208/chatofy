import { Module } from '@nestjs/common';
import { ProviderRegistry } from '@chatofy/ai-providers';
import { TRANSLATOR_SERVICE } from './interfaces/translator-service.interface';
import { AiProvidersFactory } from './providers/ai-providers.factory';
import { registerDefaultProviders } from './providers/register-default-providers';
import { NoopTranslatorService } from './services/noop-translator.service';
import { PipelineTranslatorService } from './services/pipeline-translator.service';
import { TranslateController } from './translate.controller';
import { TranslateGateway } from './translate.gateway';

/**
 * Translate module.
 *
 * - REST: POST /translate → TranslateController → PipelineTranslatorService
 *   (providers resolved by name through the ProviderRegistry populated here —
 *   the composition root; see register-default-providers.ts).
 * - WS: TranslateGateway is still stubbed; TRANSLATOR_SERVICE stays bound to
 *   NoopTranslatorService until the streaming path is implemented.
 */
@Module({
  controllers: [TranslateController],
  providers: [
    TranslateGateway,
    {
      provide: ProviderRegistry,
      useFactory: () => registerDefaultProviders(new ProviderRegistry()),
    },
    AiProvidersFactory,
    PipelineTranslatorService,
    {
      provide: TRANSLATOR_SERVICE,
      useClass: NoopTranslatorService,
    },
  ],
})
export class TranslateModule {}
