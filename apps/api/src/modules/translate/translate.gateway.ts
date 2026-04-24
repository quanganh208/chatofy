import { Inject, Logger, NotImplementedException } from '@nestjs/common';
import {
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server } from 'ws';
import {
  TRANSLATOR_SERVICE,
  TranslatorService,
} from './interfaces/translator-service.interface';

/**
 * WebSocket gateway for real-time translation.
 * Path: /ws/translate — matched by WsAdapter registered in main.ts.
 *
 * Message events (client → server):
 *   client.session.start  — open a new translation stream
 *   client.audio.frame    — send a raw audio chunk
 *   client.session.end    — close the stream
 *
 * Actual streaming logic is delegated to the TRANSLATOR_SERVICE token.
 * Handlers log the event and throw NotImplementedException until a real
 * TranslatorService implementation is bound.
 */
@WebSocketGateway({ path: '/ws/translate' })
export class TranslateGateway {
  private readonly logger = new Logger(TranslateGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    @Inject(TRANSLATOR_SERVICE) private readonly translator: TranslatorService,
  ) {}

  @SubscribeMessage('client.session.start')
  handleSessionStart(
    @MessageBody()
    payload: {
      sessionId: string;
      sourceLang: string;
      targetLang: string;
    },
  ): void {
    this.logger.log(`client.session.start — sessionId=${payload.sessionId}`);
    throw new NotImplementedException('Translation stream not yet implemented');
  }

  @SubscribeMessage('client.audio.frame')
  handleAudioFrame(
    @MessageBody() payload: { streamId: string; frame: Buffer },
  ): void {
    this.logger.log(`client.audio.frame — streamId=${payload.streamId}`);
    throw new NotImplementedException('Translation stream not yet implemented');
  }

  @SubscribeMessage('client.session.end')
  handleSessionEnd(@MessageBody() payload: { streamId: string }): void {
    this.logger.log(`client.session.end — streamId=${payload.streamId}`);
    throw new NotImplementedException('Translation stream not yet implemented');
  }
}
