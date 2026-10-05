import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ConferenceWorkerService } from './conference-worker.service';
import { ConferenceRoomRegistry } from './conference-room-registry.service';
import { ConferenceGateway } from './conference.gateway';

@Module({
  imports: [AuthModule],
  providers: [
    ConferenceWorkerService,
    ConferenceRoomRegistry,
    ConferenceGateway,
  ],
})
export class ConferenceModule {}
