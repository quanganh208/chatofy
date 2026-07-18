import { Logger, NotImplementedException } from '@nestjs/common';
import {
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { Server } from 'ws';
import { clientEventSchema, type ClientEvent } from '@chatofy/types';

/**
 * WebSocket gateway for real-time translation.
 * Path: /ws/translate — matched by WsAdapter registered in main.ts.
 *
 * Message bodies follow the SHARED WS contract (clientEventSchema in
 * @chatofy/types): each body is a full ClientEvent object whose `type`
 * discriminant matches the subscribed event name.
 *
 * Handlers validate the payload, log the event, and throw
 * NotImplementedException until the streaming path is implemented — at which
 * point the TRANSLATOR_SERVICE token gets injected here to drive it.
 */
@WebSocketGateway({ path: '/ws/translate' })
export class TranslateGateway {
  private readonly logger = new Logger(TranslateGateway.name);

  @WebSocketServer()
  server!: Server;

  @SubscribeMessage('client.session.start')
  handleSessionStart(@MessageBody() payload: unknown): void {
    const event = this.parseEvent(payload, 'client.session.start');
    this.logger.log(`client.session.start — direction=${event.direction}`);
    throw new NotImplementedException('Translation stream not yet implemented');
  }

  @SubscribeMessage('client.audio.frame')
  handleAudioFrame(@MessageBody() payload: unknown): void {
    const event = this.parseEvent(payload, 'client.audio.frame');
    this.logger.log(
      `client.audio.frame — sessionId=${event.frame.sessionId} seq=${event.frame.sequence}`,
    );
    throw new NotImplementedException('Translation stream not yet implemented');
  }

  @SubscribeMessage('client.session.end')
  handleSessionEnd(@MessageBody() payload: unknown): void {
    this.parseEvent(payload, 'client.session.end');
    this.logger.log('client.session.end');
    throw new NotImplementedException('Translation stream not yet implemented');
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
      throw new WsException(`Malformed ${type} payload`);
    }
    return parsed.data as Extract<ClientEvent, { type: T }>;
  }
}
