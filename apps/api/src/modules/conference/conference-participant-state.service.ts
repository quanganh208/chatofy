import { Injectable } from '@nestjs/common';
import {
  ConferenceParticipantMuteSchema,
  ConferenceParticipantVideoSchema,
} from '@chatofy/types';
import {
  ConferencePeerLifecycle,
  type Seat,
} from './conference-peer-lifecycle.service';
import { ConferenceSocketRegistry } from './conference-socket-registry.service';
import {
  parsePayload,
  sendEvent,
  type ConferenceSocket,
} from './conference-socket';

/**
 * The mute and camera state peers display. Mute is `track.enabled = false` on
 * the client, so packets keep flowing to the SFU; this is only the flag the
 * other tiles show.
 */
@Injectable()
export class ConferenceParticipantState {
  constructor(
    private readonly lifecycle: ConferencePeerLifecycle,
    private readonly sockets: ConferenceSocketRegistry,
  ) {}

  setMuted(ws: ConferenceSocket, body: unknown): void {
    const event = 'conference.participant.mute';
    const input = parsePayload(ConferenceParticipantMuteSchema, body);
    const seat = this.seat(ws, event, input);
    if (!seat || !input) return;
    seat.peer.muted = input.muted;
    this.broadcast(seat);
    sendEvent(ws, event, { muted: input.muted });
  }

  setVideoEnabled(ws: ConferenceSocket, body: unknown): void {
    const event = 'conference.participant.video';
    const input = parsePayload(ConferenceParticipantVideoSchema, body);
    const seat = this.seat(ws, event, input);
    if (!seat || !input) return;
    seat.peer.videoEnabled = input.videoEnabled;
    this.broadcast(seat);
    sendEvent(ws, event, { videoEnabled: input.videoEnabled });
  }

  /** The caller's seat, or null once the error reply has gone out. */
  private seat(
    ws: ConferenceSocket,
    event: string,
    input: unknown,
  ): Seat | null {
    if (!input) {
      sendEvent(ws, event, { error: 'invalid_payload' });
      return null;
    }
    const resolved = this.lifecycle.resolvePeer(ws);
    if ('error' in resolved) {
      sendEvent(ws, event, resolved);
      return null;
    }
    return resolved;
  }

  private broadcast({ room, peer, socketId }: Seat): void {
    this.sockets.sendToRoom(room, socketId, 'conference.participant.state', {
      socketId,
      muted: peer.muted,
      videoEnabled: peer.videoEnabled,
    });
  }
}
