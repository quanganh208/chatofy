import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ConferenceWorkerService } from './conference-worker.service';
import { ConferenceRoomRegistry } from './conference-room-registry.service';
import { ConferenceGateway } from './conference.gateway';
import { ConferenceMetricsService } from './conference-metrics.service';
import { ConferenceMetricsController } from './conference-metrics.controller';
import { ConferenceController } from './conference.controller';
import { ConferenceService } from './conference.service';
import { ConferencePersistenceService } from './services/conference-persistence.service';

@Module({
  imports: [AuthModule],
  controllers: [ConferenceMetricsController, ConferenceController],
  providers: [
    ConferenceWorkerService,
    ConferenceRoomRegistry,
    ConferenceMetricsService,
    ConferenceGateway,
    ConferenceService,
    ConferencePersistenceService,
  ],
})
export class ConferenceModule {}
