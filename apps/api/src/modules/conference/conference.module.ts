import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TranslateModule } from '../translate/translate.module';
import { CloudflareRealtimeClient } from './cloudflare-realtime.client';
import { ConferenceController } from './conference.controller';
import { ConferenceGateway } from './conference.gateway';
import { ConferenceParticipantState } from './conference-participant-state.service';
import { ConferencePeerLifecycle } from './conference-peer-lifecycle.service';
import { ConferenceRoomRegistry } from './conference-room-registry.service';
import { ConferenceService } from './conference.service';
import { ConferenceSfuSignaling } from './conference-sfu-signaling.service';
import { ConferenceSocketRegistry } from './conference-socket-registry.service';
import { ConferenceChat } from './services/conference-chat.service';
import { ConferencePersistenceService } from './services/conference-persistence.service';
import { ConferenceTranslationRelay } from './services/conference-translation-relay.service';
import { ConferenceTranslationRouter } from './services/conference-translation-router.service';

/**
 * Video conferencing: `/ws/conference` signaling for Cloudflare Realtime SFU,
 * and the `/conference` REST routes. Imported by AppModule only when
 * CONFERENCE_ENABLED is on.
 */
@Module({
  imports: [AuthModule, TranslateModule],
  controllers: [ConferenceController],
  providers: [
    CloudflareRealtimeClient,
    ConferenceSfuSignaling,
    ConferenceRoomRegistry,
    ConferenceSocketRegistry,
    ConferenceService,
    ConferencePersistenceService,
    ConferencePeerLifecycle,
    ConferenceParticipantState,
    ConferenceTranslationRouter,
    ConferenceTranslationRelay,
    ConferenceChat,
    ConferenceGateway,
  ],
})
export class ConferenceModule {}
