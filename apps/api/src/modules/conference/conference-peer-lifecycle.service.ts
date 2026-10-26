import { Injectable, Logger } from '@nestjs/common';
import {
  CONFERENCE_CLOSE_ENDED,
  CONFERENCE_CLOSE_REPLACED,
  ConferenceJoinSchema,
  type ConferenceEnded,
  type ConferenceErrorCode,
} from '@chatofy/types';
import {
  ConferenceRoomRegistry,
  RoomClosedError,
  type ConferenceRoom,
  type ParticipantSession,
} from './conference-room-registry.service';
import { ConferenceSfuSignaling } from './conference-sfu-signaling.service';
import { ConferenceSocketRegistry } from './conference-socket-registry.service';
import {
  parsePayload,
  sendEvent,
  SOCKET_OPEN,
  type ConferenceSocket,
} from './conference-socket';
import { ConferenceService } from './conference.service';
import { ConferencePersistenceService } from './services/conference-persistence.service';

/** The caller's seat: its room, its peer session, and its socket id. */
export interface Seat {
  room: ConferenceRoom;
  peer: ParticipantSession;
  socketId: string;
}

/** A seat resolved from its socket, or the error code to reply with. */
export type ResolvedPeer = Seat | { error: ConferenceErrorCode };

/**
 * Who is in which room: join, leave, eviction, disconnect, and the endings the
 * server initiates (owner ended the room, credentials revoked).
 *
 * A socket's `_roomId` is set only once its join has fully succeeded and is
 * cleared before the server closes it for any reason of its own, so the close
 * event that follows records no second leave.
 */
@Injectable()
export class ConferencePeerLifecycle {
  private readonly logger = new Logger(ConferencePeerLifecycle.name);

  constructor(
    private readonly rooms: ConferenceRoomRegistry,
    private readonly sockets: ConferenceSocketRegistry,
    private readonly conferences: ConferenceService,
    private readonly persistence: ConferencePersistenceService,
    private readonly sfu: ConferenceSfuSignaling,
  ) {
    rooms.onRoomClosing((room) => this.disconnectRoom(room));
  }

  async join(ws: ConferenceSocket, body: unknown): Promise<void> {
    const reply = (data: unknown) => sendEvent(ws, 'conference.join', data);
    const userId = ws._userId;
    const socketId = ws._socketId;
    const input = parsePayload(ConferenceJoinSchema, body);
    if (!input || !userId || !socketId || ws._joining) {
      reply({ error: 'invalid_payload' });
      return;
    }
    // A socket is in one room at a time: a second join leaves the first.
    if (ws._roomId) this.leave(ws);

    ws._joining = true;
    let room: ConferenceRoom | undefined;
    let joinRecorded = false;
    try {
      const before = await this.conferences.joinableStatus(input.roomId);
      if (before !== 'joinable') {
        reply({ error: before });
        return;
      }
      const participantId = await this.persistence.recordJoin(
        input.roomId,
        userId,
        input.displayName,
        input.sourceLanguage,
      );
      joinRecorded = true;
      // Held from here until `finally`, so neither an eviction below nor
      // another join aborting can drop the room as empty under this one.
      room = this.rooms.acquireForJoin(input.roomId);
      // Fetched before the re-check below, so nothing awaits between that
      // check and the peer being seated.
      const iceServers = await this.sfu.iceServersFor();
      // Re-checked after the awaits: an owner who ended the room in the
      // meantime has either flipped the status (refused here) or will close
      // this peer through the registry once it is added below.
      const after = await this.conferences.joinableStatus(input.roomId);
      if (after !== 'joinable') {
        reply({ error: after });
        return;
      }
      // Ended between the status write and its re-check above.
      if (!this.rooms.isLive(room)) throw new RoomClosedError(room.id);
      // The socket may have closed while this join awaited; its disconnect
      // already ran and found no room, so adding it now would leave a ghost
      // nothing evicts.
      if (ws.readyState !== SOCKET_OPEN) return;

      this.evictSameUser(room, userId, socketId);
      const peer = this.rooms.addPeer(room, socketId, {
        userId,
        displayName: input.displayName,
        sourceLanguage: input.sourceLanguage,
        participantId,
      });
      ws._roomId = room.id;
      joinRecorded = false; // the peer now owns the leave

      this.conferences.markActive(room.id).catch((err: unknown) => {
        this.logger.error(`markActive failed for ${room?.id}`, err);
      });

      this.sockets.sendToRoom(room, socketId, 'conference.peer.joined', {
        socketId,
        displayName: peer.displayName,
        userId,
      });
      reply({
        socketId,
        iceServers,
        peers: this.peerList(room, socketId),
      });
    } catch (err) {
      if (err instanceof RoomClosedError) {
        // The owner ended the room while this join was being seated.
        const status = await this.conferences
          .joinableStatus(input.roomId)
          .catch(() => 'joinable' as const);
        reply({ error: status === 'joinable' ? 'internal_error' : status });
      } else {
        this.logger.error(`join failed for ${socketId}`, err);
        reply({ error: 'internal_error' });
      }
    } finally {
      ws._joining = false;
      // A join that recorded its row and then aborted undoes it, unless the
      // same user still holds a seat in the room from another socket.
      if (joinRecorded && !this.hasSeat(input.roomId, userId)) {
        void this.persistence.recordLeave(input.roomId, userId);
      }
      if (room) this.rooms.releaseJoin(room);
    }
  }

  /** Leave the socket's room, if any; tells the room and records the leave. */
  leave(ws: ConferenceSocket): void {
    const { _socketId: socketId, _roomId: roomId, _userId: userId } = ws;
    ws._roomId = undefined;
    if (!socketId || !roomId) return;
    const room = this.rooms.getRoom(roomId);
    if (room?.peers.has(socketId)) {
      this.rooms.removePeer(room, socketId);
      this.sockets.sendToRoom(room, socketId, 'conference.peer.left', {
        socketId,
      });
    }
    if (userId) void this.persistence.recordLeave(roomId, userId);
  }

  resolvePeer(ws: ConferenceSocket): ResolvedPeer {
    const { _socketId: socketId, _roomId: roomId } = ws;
    if (!socketId || !roomId) return { error: 'not_in_room' };
    const room = this.rooms.getRoom(roomId);
    if (!room) return { error: 'not_in_room' };
    const peer = room.peers.get(socketId);
    if (!peer) return { error: 'peer_not_found' };
    return { room, peer, socketId };
  }

  /** Whether `peer` is still the socket's live session after an await. */
  isCurrent(resolved: Seat): boolean {
    return (
      this.rooms.isLive(resolved.room) &&
      resolved.room.peers.get(resolved.socketId) === resolved.peer
    );
  }

  /** Close every socket `userId` holds; the transport half of revocation. */
  closeSessionsFor(userId: string): number {
    let closed = 0;
    for (const socket of this.sockets.ofUser(userId)) {
      try {
        socket.close(1008, 'Credentials changed');
        closed += 1;
      } catch (err) {
        this.logger.error('failed to close a conference socket', err);
      }
    }
    return closed;
  }

  /**
   * One user, one seat per room: a rejoin (reload, reconnect after a network
   * drop) replaces the older socket. That socket is closed with 4000 so its
   * client stops instead of reconnecting and evicting the new one back.
   * Its `_roomId` is cleared first, so no leave is recorded for a user who is
   * still in the room.
   */
  private evictSameUser(
    room: ConferenceRoom,
    userId: string,
    joiningSocketId: string,
  ): void {
    for (const [staleId, stalePeer] of [...room.peers]) {
      if (stalePeer.userId !== userId || staleId === joiningSocketId) continue;
      this.rooms.removePeer(room, staleId);
      this.sockets.sendToRoom(room, staleId, 'conference.peer.left', {
        socketId: staleId,
      });
      const stale = this.sockets.get(staleId);
      if (stale) {
        stale._roomId = undefined;
        stale.close(CONFERENCE_CLOSE_REPLACED, 'replaced');
      }
      this.logger.log(`Replaced stale peer ${staleId} for user ${userId}`);
    }
  }

  /** The owner ended `room`: tell and disconnect its peers. */
  private disconnectRoom(room: ConferenceRoom): void {
    const ended: ConferenceEnded = { reason: 'ended_by_owner' };
    for (const [socketId, peer] of room.peers) {
      void this.persistence.recordLeave(room.id, peer.userId);
      const socket = this.sockets.get(socketId);
      if (!socket) continue;
      socket._roomId = undefined;
      sendEvent(socket, 'conference.ended', ended);
      socket.close(CONFERENCE_CLOSE_ENDED, 'ended');
    }
  }

  private hasSeat(roomId: string, userId: string): boolean {
    const room = this.rooms.getRoom(roomId);
    return !!room && [...room.peers.values()].some((p) => p.userId === userId);
  }

  private peerList(room: ConferenceRoom, exceptSocketId: string) {
    return [...room.peers.entries()]
      .filter(([socketId]) => socketId !== exceptSocketId)
      .map(([socketId, p]) => ({
        socketId,
        displayName: p.displayName,
        userId: p.userId,
        // `conference.media.published` only reaches peers already in the
        // room, so a late joiner learns who publishes from this list.
        published: p.publishedTracks.length > 0,
      }));
  }
}
