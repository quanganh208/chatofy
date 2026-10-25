import { Injectable, Logger } from '@nestjs/common';
import type { LanguageCode } from '@chatofy/types';
import { ConferenceSfuSignaling } from './conference-sfu-signaling.service';
import type { TokenBucket } from './conference-token-bucket';

export interface ConferenceRoom {
  id: string;
  /** socketId → participant session */
  peers: Map<string, ParticipantSession>;
  /**
   * Joins holding this room between opening it and adding their peer. An
   * empty room with a join in flight is not dropped, or that join would be
   * seated in a room nobody can reach.
   */
  joining: number;
}

/** Per-peer rate limits, created lazily by the handler that owns each one. */
export interface PeerLimits {
  chat?: TokenBucket;
  relayFrames?: TokenBucket;
  relayChars?: TokenBucket;
  /** `conference.media.*` requests, each of which drives Cloudflare calls. */
  media?: TokenBucket;
}

export type MediaKind = 'audio' | 'video';

/** A track this peer publishes on its SFU publish session. */
export interface PublishedTrack {
  /** The `mid` on the publisher's own session. */
  mid: string;
  kind: MediaKind;
  /** The name other sessions pull it by; it is the kind. */
  trackName: string;
}

/** Whose track a receiving `mid` carries. */
export interface PulledFrom {
  socketId: string;
  kind: MediaKind;
}

export interface ParticipantSession {
  userId: string;
  displayName: string;
  sourceLanguage: LanguageCode;
  /** The ConferenceParticipant row this peer's turns and messages belong to. */
  participantId: string;
  muted: boolean;
  videoEnabled: boolean;
  /** The SFU session this peer publishes on, created by its first publish. */
  pubSessionId?: string;
  /** The SFU session this peer receives on, created by its first subscribe. */
  subSessionId?: string;
  publishedTracks: PublishedTrack[];
  /** `mid` on the receiving session → the peer and kind it carries. */
  pulled: Map<string, PulledFrom>;
  /** Turns already persisted, so a repeated final frame writes nothing. */
  persistedTurnIds: Set<string>;
  limits: PeerLimits;
}

export type NewParticipant = Pick<
  ParticipantSession,
  'userId' | 'displayName' | 'sourceLanguage' | 'participantId'
>;

/** Told about a room with peers right before the owner's end tears it down. */
export type RoomClosingListener = (room: ConferenceRoom) => void;

/** The owner ended a room while a join was still being seated in it. */
export class RoomClosedError extends Error {
  constructor(roomId: string) {
    super(`room ${roomId} was closed while it was being joined`);
    this.name = 'RoomClosedError';
  }
}

/**
 * The live rooms on this API instance. A room is in-memory membership only:
 * media lives on Cloudflare's SFU, so opening one costs nothing and closing
 * one closes its peers' SFU tracks.
 */
@Injectable()
export class ConferenceRoomRegistry {
  private readonly logger = new Logger(ConferenceRoomRegistry.name);
  private readonly rooms = new Map<string, ConferenceRoom>();
  private readonly closingListeners = new Set<RoomClosingListener>();

  constructor(private readonly sfu: ConferenceSfuSignaling) {}

  onRoomClosing(listener: RoomClosingListener): void {
    this.closingListeners.add(listener);
  }

  getOrCreateRoom(roomId: string): ConferenceRoom {
    const existing = this.rooms.get(roomId);
    if (existing) return existing;
    const room: ConferenceRoom = { id: roomId, peers: new Map(), joining: 0 };
    this.rooms.set(roomId, room);
    this.logger.log(`Room created: ${roomId}`);
    return room;
  }

  /** Open (or share) the room for a join, holding it open until released. */
  acquireForJoin(roomId: string): ConferenceRoom {
    const room = this.getOrCreateRoom(roomId);
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
      publishedTracks: [],
      pulled: new Map(),
      persistedTurnIds: new Set(),
      limits: {},
    };
    room.peers.set(socketId, peer);
    return peer;
  }

  /**
   * Remove a peer and close its SFU tracks, and every other peer's copy of
   * them, in the background. The room closes when it is left empty and no
   * join is holding it.
   */
  removePeer(room: ConferenceRoom, socketId: string): void {
    const peer = room.peers.get(socketId);
    if (!peer) return;
    room.peers.delete(socketId);
    this.sfu.cleanupPeer(room, socketId, peer);
    this.dropIfEmpty(room);
  }

  /** Close a room nobody is in or joining, e.g. after a join aborted mid-way. */
  dropIfEmpty(room: ConferenceRoom): void {
    if (room.peers.size > 0 || room.joining > 0 || !this.isLive(room)) return;
    this.rooms.delete(room.id);
    this.logger.log(`Room removed (empty): ${room.id}`);
  }

  /**
   * End one room: listeners notify and disconnect its peers, and every
   * peer's SFU tracks close in the background, not awaited.
   */
  endRoom(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    this.rooms.delete(room.id);
    for (const listener of this.closingListeners) {
      try {
        listener(room);
      } catch (err) {
        this.logger.error('a room-closing listener threw', err);
      }
    }
    this.sfu.cleanupRoom(room);
    room.peers.clear();
    this.logger.log(`Room closed (ended): ${room.id}`);
  }
}
