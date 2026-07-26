import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WsException,
  type OnGatewayDisconnect,
} from '@nestjs/websockets';
import { clientEventSchema, type ClientEvent } from '@chatofy/types';
import {
  TranslationSessionService,
  type StreamSocket,
} from './services/translation-session.service';

/**
 * WebSocket gateway for real-time translation.
 * Path: /ws/translate — matched by WsAdapter registered in main.ts.
 *
 * Message bodies follow the SHARED WS contract (clientEventSchema in
 * @chatofy/types): each body is a full ClientEvent object whose `type`
 * discriminant matches the subscribed event name.
 *
 * This class is transport only — it validates the payload and hands it to
 * TranslationSessionService, which owns the per-connection state machine.
 * Replies are pushed onto the socket by that service rather than returned from
 * these handlers, because a turn emits several events at different times.
 */
@WebSocketGateway({ path: '/ws/translate' })
export class TranslateGateway implements OnGatewayDisconnect {
  private readonly logger = new Logger(TranslateGateway.name);

  constructor(private readonly sessions: TranslationSessionService) {}

  @SubscribeMessage('client.session.start')
  handleSessionStart(
    @MessageBody() payload: unknown,
    @ConnectedSocket() client: StreamSocket,
  ): void {
    const event = this.parseEvent(payload, 'client.session.start');
    this.sessions.start(client, event.direction);
  }

  @SubscribeMessage('client.audio.frame')
  handleAudioFrame(
    @MessageBody() payload: unknown,
    @ConnectedSocket() client: StreamSocket,
  ): void {
    const event = this.parseEvent(payload, 'client.audio.frame');
    this.sessions.pushFrame(client, event.frame);
  }

  /**
   * A suspected end of speech. Fire-and-forget by design: the turn's answer
   * still arrives on `client.session.end`, this only lets the work start early.
   */
  @SubscribeMessage('client.turn.speculate')
  handleTurnSpeculate(
    @MessageBody() payload: unknown,
    @ConnectedSocket() client: StreamSocket,
  ): void {
    this.parseEvent(payload, 'client.turn.speculate');
    this.sessions.speculate(client);
  }

  @SubscribeMessage('client.session.end')
  handleSessionEnd(
    @MessageBody() payload: unknown,
    @ConnectedSocket() client: StreamSocket,
  ): Promise<void> {
    this.parseEvent(payload, 'client.session.end');
    return this.sessions.end(client);
  }

  /** Free the turn held for a socket that dropped mid-utterance. */
  handleDisconnect(client: StreamSocket): void {
    this.sessions.disconnect(client);
  }

  /**
   * Validate an incoming message body against the shared contract and narrow it
   * to the event type this handler subscribed to.
   */
  private parseEvent<T extends ClientEvent['type']>(
    payload: unknown,
    type: T,
  ): Extract<ClientEvent, { type: T }> {
    const parsed = clientEventSchema.safeParse(payload);
    if (!parsed.success || parsed.data.type !== type) {
      this.logger.warn(`Malformed ${type} payload`);
      throw new WsException(`Malformed ${type} payload`);
    }
    return parsed.data as Extract<ClientEvent, { type: T }>;
  }
}
