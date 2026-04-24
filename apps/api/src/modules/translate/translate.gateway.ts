import { Inject, Logger } from '@nestjs/common';
import {
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { IncomingMessage } from 'http';
import type { Server, WebSocket } from 'ws';
import {
  TRANSLATOR_SERVICE,
  type TranslatorService,
} from './interfaces/translator-service.interface.js';

interface SessionStartPayload {
  sessionId: string;
  sourceLanguage: string;
  targetLanguage: string;
}

interface AudioFramePayload {
  streamId: string;
  /** Base64-encoded PCM16 audio chunk. */
  audio: string;
}

interface SessionEndPayload {
  streamId: string;
}

/**
 * WebSocket gateway for real-time translation.
 * Path: /ws/translate (matched by WsAdapter).
 * Events in:  client.session.start | client.audio.frame | client.session.end
 * Events out: server.transcript | server.error (emitted by TranslatorService impl)
 */
@WebSocketGateway({ path: '/ws/translate' })
export class TranslateGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(TranslateGateway.name);

  constructor(
    @Inject(TRANSLATOR_SERVICE)
    private readonly translator: TranslatorService,
  ) {}

  handleConnection(client: WebSocket, req: IncomingMessage): void {
    this.logger.log(`Client connected: ${req.socket.remoteAddress}`);
  }

  handleDisconnect(client: WebSocket): void {
    this.logger.log('Client disconnected');
  }

  @SubscribeMessage('client.session.start')
  async handleSessionStart(client: WebSocket, payload: SessionStartPayload): Promise<void> {
    this.logger.debug({ event: 'client.session.start', payload });
    const handle = await this.translator.startStream(
      // Use remote address as clientId stub — real impl uses authenticated user ID.
      'anonymous',
      {
        sessionId: payload.sessionId,
        sourceLanguage: payload.sourceLanguage,
        targetLanguage: payload.targetLanguage,
      },
    );
    // Notify client of assigned streamId.
    client.send(JSON.stringify({ event: 'server.stream.ready', data: handle }));
  }

  @SubscribeMessage('client.audio.frame')
  async handleAudioFrame(_client: WebSocket, payload: AudioFramePayload): Promise<void> {
    this.logger.debug({
      event: 'client.audio.frame',
      streamId: payload.streamId,
      bytes: payload.audio.length,
    });
    const frame = Buffer.from(payload.audio, 'base64');
    await this.translator.handleAudioFrame(payload.streamId, frame);
  }

  @SubscribeMessage('client.session.end')
  async handleSessionEnd(_client: WebSocket, payload: SessionEndPayload): Promise<void> {
    this.logger.debug({ event: 'client.session.end', payload });
    await this.translator.endStream(payload.streamId);
  }
}
