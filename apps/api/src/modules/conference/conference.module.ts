import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ConferenceWorkerService } from './conference-worker.service';
import { ConferenceRoomRegistry } from './conference-room-registry.service';
import { ConferenceGateway } from './conference.gateway';
import { ConferenceMetricsService } from './conference-metrics.service';
import { ConferenceMetricsController } from './conference-metrics.controller';

@Module({
  imports: [AuthModule],
  controllers: [ConferenceMetricsController],
  providers: [
    ConferenceWorkerService,
    ConferenceRoomRegistry,
    ConferenceMetricsService,
    ConferenceGateway,
  ],
})
export class ConferenceModule {}
