import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GlossaryModule } from '../glossary/glossary.module';
import { ProviderRegistry } from '@chatofy/ai-providers';
import { AiProvidersFactory } from './providers/ai-providers.factory';
import { registerDefaultProviders } from './providers/register-default-providers';
import { PipelineTranslatorService } from './services/pipeline-translator.service';
import { TranslationSessionService } from './services/translation-session.service';
import { TurnMetricsRecorder } from './services/turn-metrics.recorder';
import { LiveSessionMetricsRecorder } from './services/live-session-metrics.recorder';
import { LiveTranslateSessionService } from './services/live-translate-session.service';
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
 *
 * A THIRD transport shares that path and none of the pipeline:
 *
 * - WS: /ws/translate, opened with `client.live.start` → the same
 *   TranslateGateway → LiveTranslateSessionService → a RealtimeProvider, which
 *   does speech-to-speech in one upstream stream. It exists to be compared
 *   against the trio above, so it deliberately reuses nothing that would make
 *   the two paths share a fate — separate contract, separate state machine,
 *   separate metrics row. What it does share is the path, the provider registry,
 *   the outbound frame slicer and the concurrency ceiling.
 */
@Module({
  imports: [AuthModule, GlossaryModule],
  controllers: [TranslateController],
  providers: [
    TranslateGateway,
    LiveTranslateSessionService,
    LiveSessionMetricsRecorder,
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
