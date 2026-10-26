import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MinutesModule } from '../minutes/minutes.module';
import { TranslateModule } from '../translate/translate.module';
import { ConferenceMinutesController } from './conference-minutes.controller';
import { ConferenceMinutesService } from './services/conference-minutes.service';
import { PrismaConferenceMinutesStore } from './stores/prisma-conference-minutes.store';
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
 * and the `/conference` REST routes. Always imported by AppModule.
 */
@Module({
  // MinutesModule for its MinutesSummarizer: a room's minutes run the same
  // resolved provider the conversation minutes do.
  imports: [AuthModule, TranslateModule, MinutesModule],
  controllers: [ConferenceController, ConferenceMinutesController],
  providers: [
    PrismaConferenceMinutesStore,
    ConferenceMinutesService,
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
