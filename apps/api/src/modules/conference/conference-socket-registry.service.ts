import { Injectable } from '@nestjs/common';
import type { ConferenceRoom } from './conference-room-registry.service';
import { sendEvent, type ConferenceSocket } from './conference-socket';

/**
 * Every open `/ws/conference` socket, by the socket id the gateway minted.
 *
 * Room fan-out goes through `room.peers` and this map rather than by scanning
 * the server's client set for a matching `_roomId`: membership is then decided
 * in one place, so a socket that was evicted or whose room ended stops
 * receiving room events the moment it leaves `room.peers`.
 */
@Injectable()
export class ConferenceSocketRegistry {
  private readonly sockets = new Map<string, ConferenceSocket>();

  add(socket: ConferenceSocket): void {
    if (socket._socketId) this.sockets.set(socket._socketId, socket);
  }

  remove(socket: ConferenceSocket): void {
    if (socket._socketId && this.sockets.get(socket._socketId) === socket) {
      this.sockets.delete(socket._socketId);
    }
  }

  get(socketId: string): ConferenceSocket | undefined {
    return this.sockets.get(socketId);
  }

  /** Every open socket belonging to `userId`. */
  ofUser(userId: string): ConferenceSocket[] {
    return [...this.sockets.values()].filter((s) => s._userId === userId);
  }

  /** Send to one socket by id; a socket that is gone is skipped. */
  sendTo(socketId: string, event: string, data: unknown): void {
    const socket = this.sockets.get(socketId);
    if (socket) sendEvent(socket, event, data);
  }

  /** Send to every peer in `room` except `excludeSocketId`. */
  sendToRoom(
    room: ConferenceRoom,
    excludeSocketId: string | undefined,
    event: string,
    data: unknown,
  ): void {
    for (const socketId of room.peers.keys()) {
      if (socketId !== excludeSocketId) this.sendTo(socketId, event, data);
    }
  }
}
