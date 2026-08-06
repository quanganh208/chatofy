import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WsException,
  type OnGatewayDisconnect,
} from '@nestjs/websockets';
import { liveClientEventSchema, type LiveClientEvent } from '@chatofy/types';
import { LiveTranslateSessionService } from './session/live-translate-session.service';
import type { StreamSocket } from './session/stream-socket';

/**
 * WebSocket gateway for continuous speech-to-speech translation.
 * Path: /ws/live-translate — a SECOND path beside /ws/translate, both served by
 * the one WsAdapter registered in main.ts.
 *
 * Separate rather than a mode flag on the turn contract. `clientEventSchema` is
 * validated by the web app, the extension and mobile, and only the web app is in
 * scope here; a new branch inside it would put every other client one bad deploy
 * away from a contract it never asked for. With a separate path and a separate
 * union, the turn contract changes by zero lines, which is a structural
 * guarantee rather than a promise to be careful.
 *
 * Transport only, like `TranslateGateway`: it validates and delegates, and the
 * replies are pushed onto the socket by the service because one session emits
 * many events over its life.
 */
@WebSocketGateway({ path: '/ws/live-translate' })
export class LiveTranslateGateway implements OnGatewayDisconnect {
  private readonly logger = new Logger(LiveTranslateGateway.name);

  constructor(private readonly sessions: LiveTranslateSessionService) {}

  @SubscribeMessage('client.live.start')
  handleStart(
    @MessageBody() payload: unknown,
    @ConnectedSocket() client: StreamSocket,
  ): Promise<void> {
    const { direction } = this.parseEvent(payload, 'client.live.start');
    return this.sessions.start(client, direction);
  }

  @SubscribeMessage('client.live.audio')
  handleAudio(
    @MessageBody() payload: unknown,
    @ConnectedSocket() client: StreamSocket,
  ): Promise<void> {
    const event = this.parseEvent(payload, 'client.live.audio');
    return this.sessions.pushFrame(client, event.frame);
  }

  @SubscribeMessage('client.live.stop')
  handleStop(
    @MessageBody() payload: unknown,
    @ConnectedSocket() client: StreamSocket,
  ): Promise<void> {
    this.parseEvent(payload, 'client.live.stop');
    return this.sessions.stop(client, 'client_stopped');
  }

  /** Free the upstream session held for a socket that dropped mid-conversation. */
  handleDisconnect(client: StreamSocket): void {
    void this.sessions.stop(client, 'disconnected');
  }

  private parseEvent<T extends LiveClientEvent['type']>(
    payload: unknown,
    type: T,
  ): Extract<LiveClientEvent, { type: T }> {
    const parsed = liveClientEventSchema.safeParse(payload);
    if (!parsed.success || parsed.data.type !== type) {
      this.logger.warn(`Malformed ${type} payload`);
      throw new WsException(`Malformed ${type} payload`);
    }
    return parsed.data as Extract<LiveClientEvent, { type: T }>;
  }
}
