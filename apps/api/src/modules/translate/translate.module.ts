import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProviderRegistry } from '@chatofy/ai-providers';
import { AiProvidersFactory } from './providers/ai-providers.factory';
import { registerDefaultProviders } from './providers/register-default-providers';
import { SpeechLanguageSupport } from './providers/speech-language-support';
import { PipelineTranslatorService } from './services/pipeline-translator.service';
import { TranslationSessionService } from './services/translation-session.service';
import { TurnMetricsRecorder } from './services/turn-metrics.recorder';
import {
  DeclaredLanguageIdentifier,
  LANGUAGE_IDENTIFIER,
} from './session/language-identifier';
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
  imports: [AuthModule],
  controllers: [TranslateController],
  providers: [
    TranslateGateway,
    {
      provide: ProviderRegistry,
      useFactory: () => registerDefaultProviders(new ProviderRegistry()),
    },
    AiProvidersFactory,
    SpeechLanguageSupport,
    PipelineTranslatorService,
    TranslationSessionService,
    TurnMetricsRecorder,
    // The real policy every turn runs today: trust the client's declared
    // language outright. Swapping in an audio-based identifier later is a
    // one-line change here, not a rewire of the callers that use the token.
    { provide: LANGUAGE_IDENTIFIER, useClass: DeclaredLanguageIdentifier },
  ],
  exports: [PipelineTranslatorService],
})
export class TranslateModule {}
