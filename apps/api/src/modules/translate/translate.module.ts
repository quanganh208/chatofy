import { Module } from '@nestjs/common';
import { ProviderRegistry } from '@chatofy/ai-providers';
import { AiProvidersFactory } from './providers/ai-providers.factory';
import { registerDefaultProviders } from './providers/register-default-providers';
import { PipelineTranslatorService } from './services/pipeline-translator.service';
import { TranslationSessionService } from './services/translation-session.service';
import { TurnMetricsRecorder } from './services/turn-metrics.recorder';
import { TranslateController } from './translate.controller';
import { TranslateGateway } from './translate.gateway';

/**
 * Translate module.
 *
 * Both transports run the same turn through PipelineTranslatorService, so the
 * REST path stays a faithful latency baseline for the streaming one:
 *
 * - REST: POST /translate → TranslateController → PipelineTranslatorService
 *   (providers resolved by name through the ProviderRegistry populated here —
 *   the composition root; see register-default-providers.ts).
 * - WS: /ws/translate → TranslateGateway (transport + validation) →
 *   TranslationSessionService (per-connection state machine) → the same
 *   pipeline.
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
    TranslationSessionService,
    TurnMetricsRecorder,
  ],
})
export class TranslateModule {}
