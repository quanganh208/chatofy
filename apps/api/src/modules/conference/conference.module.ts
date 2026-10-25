import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TranslateModule } from '../translate/translate.module';
import { ConferenceController } from './conference.controller';
import { ConferenceGateway } from './conference.gateway';
import { ConferenceMediaSignaling } from './conference-media-signaling.service';
import { ConferenceMetricsController } from './conference-metrics.controller';
import { ConferenceMetricsService } from './conference-metrics.service';
import { ConferencePeerLifecycle } from './conference-peer-lifecycle.service';
import { ConferenceRoomRegistry } from './conference-room-registry.service';
import { ConferenceService } from './conference.service';
import { ConferenceSocketRegistry } from './conference-socket-registry.service';
import { ConferenceWebRtcTransportFactory } from './conference-webrtc-transport.factory';
import { ConferenceWorkerService } from './conference-worker.service';
import { ConferenceChat } from './services/conference-chat.service';
import { ConferencePersistenceService } from './services/conference-persistence.service';
import { ConferenceTranslationRelay } from './services/conference-translation-relay.service';
import { ConferenceTranslationRouter } from './services/conference-translation-router.service';

/**
 * Video conferencing: the mediasoup SFU, `/ws/conference`, and the
 * `/conference` REST routes. Imported by AppModule only when
 * CONFERENCE_ENABLED is on.
 */
@Module({
  imports: [AuthModule, TranslateModule],
  controllers: [ConferenceMetricsController, ConferenceController],
  providers: [
    ConferenceWorkerService,
    ConferenceRoomRegistry,
    ConferenceSocketRegistry,
    ConferenceWebRtcTransportFactory,
    ConferenceMetricsService,
    ConferenceService,
    ConferencePersistenceService,
    ConferencePeerLifecycle,
    ConferenceMediaSignaling,
    ConferenceTranslationRouter,
    ConferenceTranslationRelay,
    ConferenceChat,
    ConferenceGateway,
  ],
})
export class ConferenceModule {}
