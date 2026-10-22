import { Injectable, Logger } from '@nestjs/common';
import type { types } from 'mediasoup';
import { ConferenceWorkerService } from './conference-worker.service';

/**
 * Mediasoup codec capabilities offered by every room router.
 *
 * preferredPayloadType values follow the IANA RTP payload type registry and
 * mediasoup's own defaults — required by the type in v3.28+.
 */
const MEDIA_CODECS: types.RtpCodecCapability[] = [
  {
    kind: 'audio',
    mimeType: 'audio/opus',
    preferredPayloadType: 111,
    clockRate: 48000,
    channels: 2,
  },
  {
    kind: 'video',
    mimeType: 'video/VP8',
    preferredPayloadType: 96,
    clockRate: 90000,
    parameters: {},
  },
  {
    kind: 'video',
    mimeType: 'video/H264',
    preferredPayloadType: 101,
    clockRate: 90000,
    parameters: {
      'packetization-mode': 1,
      'profile-level-id': '42e01f',
      'level-asymmetry-allowed': 1,
    },
  },
];

export interface ConferenceRoom {
  id: string;
  router: types.Router;
  /** socketId → participant session */
  peers: Map<string, ParticipantSession>;
}

export interface ParticipantSession {
  userId: string;
  displayName: string;
  sourceLanguage: string;
  participantId?: string;
  muted: boolean;
  videoEnabled: boolean;
  sendTransport: types.WebRtcTransport | null;
  recvTransport: types.WebRtcTransport | null;
  producers: Map<string, types.Producer>;
  consumers: Map<string, types.Consumer>;
}

/** @deprecated Use ParticipantSession */
export type PeerState = ParticipantSession;

@Injectable()
export class ConferenceRoomRegistry {
  private readonly logger = new Logger(ConferenceRoomRegistry.name);
  private readonly rooms = new Map<string, ConferenceRoom>();

  constructor(private readonly workerService: ConferenceWorkerService) {}

  async getOrCreateRoom(roomId: string): Promise<ConferenceRoom> {
    const existing = this.rooms.get(roomId);
    if (existing) return existing;

    const router = await this.workerService.getWorker().createRouter({
      mediaCodecs: MEDIA_CODECS,
    });

    const room: ConferenceRoom = { id: roomId, router, peers: new Map() };
    this.rooms.set(roomId, room);
    this.logger.log(`Room created: ${roomId}`);
    return room;
  }

  getRoom(roomId: string): ConferenceRoom | undefined {
    return this.rooms.get(roomId);
  }

  getAllRooms(): ConferenceRoom[] {
    return [...this.rooms.values()];
  }

  addPeer(
    room: ConferenceRoom,
    socketId: string,
    userId: string,
    displayName: string,
    sourceLanguage = 'vi',
  ): ParticipantSession {
    const peer: ParticipantSession = {
      userId,
      displayName,
      sourceLanguage,
      muted: false,
      videoEnabled: true,
      sendTransport: null,
      recvTransport: null,
      producers: new Map(),
      consumers: new Map(),
    };
    room.peers.set(socketId, peer);
    return peer;
  }

  removePeer(room: ConferenceRoom, socketId: string): void {
    const peer = room.peers.get(socketId);
    if (!peer) return;

    peer.producers.forEach((p) => p.close());
    peer.consumers.forEach((c) => c.close());
    peer.sendTransport?.close();
    peer.recvTransport?.close();
    room.peers.delete(socketId);

    if (room.peers.size === 0) {
      room.router.close();
      this.rooms.delete(room.id);
      this.logger.log(`Room removed (empty): ${room.id}`);
    }
  }
}
