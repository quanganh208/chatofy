import { Injectable, Logger } from '@nestjs/common';
import type { types } from 'mediasoup';
import type { LanguageCode } from '@chatofy/types';
import { ConferenceWorkerService } from './conference-worker.service';
import type { TokenBucket } from './conference-token-bucket';

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
  /**
   * Joins holding this room between opening it and adding their peer. An
   * empty room with a join in flight is not dropped, or that join would be
   * seated on a closed router.
   */
  joining: number;
}

/** Per-peer rate limits, created lazily by the handler that owns each one. */
export interface PeerLimits {
  chat?: TokenBucket;
  relayFrames?: TokenBucket;
  relayChars?: TokenBucket;
}

export interface ParticipantSession {
  userId: string;
  displayName: string;
  sourceLanguage: LanguageCode;
  /** The ConferenceParticipant row this peer's turns and messages belong to. */
  participantId: string;
  muted: boolean;
  videoEnabled: boolean;
  sendTransport: types.WebRtcTransport | null;
  recvTransport: types.WebRtcTransport | null;
  /** Directions whose transport is being created right now. */
  creatingTransports: Set<'send' | 'recv'>;
  /** Produce / consume calls awaiting mediasoup, counted against the caps. */
  pendingProduces: number;
  pendingConsumes: number;
  producers: Map<string, types.Producer>;
  consumers: Map<string, types.Consumer>;
  /** Turns already persisted, so a repeated final frame writes nothing. */
  persistedTurnIds: Set<string>;
  limits: PeerLimits;
}

export type NewParticipant = Pick<
  ParticipantSession,
  'userId' | 'displayName' | 'sourceLanguage' | 'participantId'
>;

/**
 * Why a room is being torn down while it still has peers:
 * - `ended`: the owner ended it through `DELETE /conference/:id`.
 * - `media_restart`: the mediasoup worker died and every room went with it.
 */
export type RoomCloseReason = 'ended' | 'media_restart';

/** Told about a room with peers right before it is torn down. */
export type RoomClosingListener = (
  room: ConferenceRoom,
  reason: RoomCloseReason,
) => void;

/** A room was ended while its router was still being created. */
export class RoomClosedError extends Error {
  constructor(roomId: string) {
    super(`room ${roomId} was closed while it was being opened`);
    this.name = 'RoomClosedError';
  }
}

/**
 * The live rooms on this API instance, one mediasoup router each.
 *
 * Creation is memoised per room id: concurrent first joins (every client
 * reconnecting after a restart) share one in-flight router instead of each
 * creating one and the last `set` orphaning the others.
 */
@Injectable()
export class ConferenceRoomRegistry {
  private readonly logger = new Logger(ConferenceRoomRegistry.name);
  private readonly rooms = new Map<string, ConferenceRoom>();
  private readonly pending = new Map<string, Promise<ConferenceRoom>>();
  private readonly closingListeners = new Set<RoomClosingListener>();

  constructor(private readonly workerService: ConferenceWorkerService) {
    workerService.onWorkerDied(() => this.closeAll('media_restart'));
  }

  onRoomClosing(listener: RoomClosingListener): void {
    this.closingListeners.add(listener);
  }

  getOrCreateRoom(roomId: string): Promise<ConferenceRoom> {
    const existing = this.rooms.get(roomId);
    if (existing) return Promise.resolve(existing);
    const inflight = this.pending.get(roomId);
    if (inflight) return inflight;

    const created: Promise<ConferenceRoom> = this.workerService
      .getWorker()
      .createRouter({ mediaCodecs: MEDIA_CODECS })
      .then(
        (router) => {
          // `endRoom` / `closeAll` drop the pending entry to cancel a creation
          // they raced with; a router that finishes after that is discarded.
          if (this.pending.get(roomId) !== created) {
            router.close();
            throw new RoomClosedError(roomId);
          }
          this.pending.delete(roomId);
          const room: ConferenceRoom = {
            id: roomId,
            router,
            peers: new Map(),
            joining: 0,
          };
          this.rooms.set(roomId, room);
          this.logger.log(`Room created: ${roomId}`);
          return room;
        },
        (err: unknown) => {
          if (this.pending.get(roomId) === created) this.pending.delete(roomId);
          throw err;
        },
      );
    this.pending.set(roomId, created);
    return created;
  }

  /** Open (or share) the room for a join, holding it open until released. */
  async acquireForJoin(roomId: string): Promise<ConferenceRoom> {
    const room = await this.getOrCreateRoom(roomId);
    room.joining += 1;
    return room;
  }

  /** The join is done with `room` — seated or aborted. */
  releaseJoin(room: ConferenceRoom): void {
    room.joining = Math.max(0, room.joining - 1);
    this.dropIfEmpty(room);
  }

  getRoom(roomId: string): ConferenceRoom | undefined {
    return this.rooms.get(roomId);
  }

  /** True while `room` is the registry's live room for its id. */
  isLive(room: ConferenceRoom): boolean {
    return this.rooms.get(room.id) === room;
  }

  getAllRooms(): ConferenceRoom[] {
    return [...this.rooms.values()];
  }

  addPeer(
    room: ConferenceRoom,
    socketId: string,
    participant: NewParticipant,
  ): ParticipantSession {
    const peer: ParticipantSession = {
      ...participant,
      muted: false,
      videoEnabled: true,
      sendTransport: null,
      recvTransport: null,
      creatingTransports: new Set(),
      pendingProduces: 0,
      pendingConsumes: 0,
      producers: new Map(),
      consumers: new Map(),
      persistedTurnIds: new Set(),
      limits: {},
    };
    room.peers.set(socketId, peer);
    return peer;
  }

  /**
   * Remove a peer and close its media. The room closes when it is left empty
   * and no join is holding it.
   */
  removePeer(room: ConferenceRoom, socketId: string): void {
    const peer = room.peers.get(socketId);
    if (!peer) return;
    closePeerMedia(peer);
    room.peers.delete(socketId);
    this.dropIfEmpty(room);
  }

  /** Close a room nobody is in or joining, e.g. after a join aborted mid-way. */
  dropIfEmpty(room: ConferenceRoom): void {
    if (room.peers.size > 0 || room.joining > 0 || !this.isLive(room)) return;
    this.rooms.delete(room.id);
    room.router.close();
    this.logger.log(`Room removed (empty): ${room.id}`);
  }

  /**
   * End one room: listeners notify and disconnect its peers, then every
   * transport and the router close. Also cancels a creation still in flight.
   */
  endRoom(roomId: string): void {
    this.pending.delete(roomId);
    const room = this.rooms.get(roomId);
    if (room) this.close(room, 'ended');
  }

  private closeAll(reason: RoomCloseReason): void {
    this.pending.clear();
    for (const room of [...this.rooms.values()]) this.close(room, reason);
  }

  private close(room: ConferenceRoom, reason: RoomCloseReason): void {
    this.rooms.delete(room.id);
    for (const listener of this.closingListeners) {
      try {
        listener(room, reason);
      } catch (err) {
        this.logger.error('a room-closing listener threw', err);
      }
    }
    for (const peer of room.peers.values()) closePeerMedia(peer);
    room.peers.clear();
    try {
      room.router.close();
    } catch (err) {
      // A router on a dead worker may already be gone.
      this.logger.warn(`router close failed for ${room.id}: ${String(err)}`);
    }
    this.logger.log(`Room closed (${reason}): ${room.id}`);
  }
}

function closePeerMedia(peer: ParticipantSession): void {
  peer.producers.forEach((p) => p.close());
  peer.consumers.forEach((c) => c.close());
  peer.sendTransport?.close();
  peer.recvTransport?.close();
  peer.producers.clear();
  peer.consumers.clear();
  peer.sendTransport = null;
  peer.recvTransport = null;
}
