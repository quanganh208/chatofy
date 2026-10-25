import { Inject, Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import {
  AUTH_ADAPTER,
  type AuthAdapter,
} from '../auth/interfaces/auth-adapter.interface';
import {
  SessionTerminator,
  type TerminableTransport,
} from '../auth/session-terminator';
import {
  createVerifyClient,
  handleProtocols,
  tokenFromUpgradeRequest,
  verifiedUserId,
} from '../translate/ws-auth';
import { ConferenceMediaSignaling } from './conference-media-signaling.service';
import { ConferencePeerLifecycle } from './conference-peer-lifecycle.service';
import { ConferenceSocketRegistry } from './conference-socket-registry.service';
import { sendEvent, type ConferenceSocket } from './conference-socket';
import { ConferenceChat } from './services/conference-chat.service';
import { ConferenceTranslationRelay } from './services/conference-translation-relay.service';

/** How often a ping goes out; a socket that missed the previous one is dropped. */
const PING_INTERVAL_MS = 30_000;

/**
 * Largest frame the conference socket accepts. The biggest legitimate message
 * is a translated-speech frame (at most 320 000 base64 characters); `ws`
 * would otherwise buffer up to 100 MiB per message before any handler runs.
 */
const MAX_PAYLOAD_BYTES = 512 * 1024;

/** The parts of the `ws` server the gateway touches at init. */
interface ConferenceServer {
  options: { verifyClient?: unknown; handleProtocols?: unknown };
  clients: Set<ConferenceSocket & { ping(): void }>;
  on(event: 'close', listener: () => void): void;
}

/** A conference socket as `ws` hands it over, with its event emitter. */
type ConnectingSocket = ConferenceSocket & {
  on(event: 'pong', listener: () => void): void;
};

/**
 * WebSocket transport for `/ws/conference`.
 *
 * Transport only: authenticates the upgrade, keeps sockets alive, and hands
 * each event body — untyped, as it arrived — to the service that owns it.
 * Those services `safeParse` every body against `@chatofy/types` and reply on
 * the same event name, with `{ error: <code> }` on failure.
 */
@WebSocketGateway({ path: '/ws/conference', maxPayload: MAX_PAYLOAD_BYTES })
export class ConferenceGateway
  implements
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    TerminableTransport
{
  private readonly logger = new Logger(ConferenceGateway.name);

  constructor(
    private readonly sockets: ConferenceSocketRegistry,
    private readonly lifecycle: ConferencePeerLifecycle,
    private readonly media: ConferenceMediaSignaling,
    private readonly translation: ConferenceTranslationRelay,
    private readonly chat: ConferenceChat,
    @Inject(AUTH_ADAPTER) private readonly auth: AuthAdapter,
    terminator: SessionTerminator,
  ) {
    // A revoked session must not keep its camera, microphone and the room's
    // media open: register so a password reset or refresh-reuse detection
    // closes this user's conference sockets too.
    terminator.register(this);
  }

  /**
   * Install upgrade-time auth (same pattern as TranslateGateway.afterInit).
   * Decorator options are evaluated at class definition time — before DI exists —
   * so verifyClient must be set here, after the adapter is injected.
   */
  afterInit(server: ConferenceServer): void {
    server.options.verifyClient = createVerifyClient(
      (token) => this.auth.verifyToken(token),
      this.logger,
    );
    server.options.handleProtocols = handleProtocols;

    // Heartbeat. A peer that missed a pong is dropped with `terminate()`: a
    // dead TCP peer never completes a closing handshake, so `close()` would
    // keep its ghost in the room for ws's whole close timeout.
    const pingInterval = setInterval(() => {
      server.clients.forEach((ws) => {
        if (ws._isAlive === false) {
          ws.terminate();
          return;
        }
        ws._isAlive = false;
        ws.ping();
      });
    }, PING_INTERVAL_MS);
    pingInterval.unref();
    server.on('close', () => clearInterval(pingInterval));
  }

  handleConnection(ws: ConnectingSocket, req: unknown): void {
    const userId = verifiedUserId(req);
    if (userId === undefined) {
      ws.close(1008, 'unauthorized');
      return;
    }
    ws._userId = userId;
    ws._socketId = crypto.randomUUID();
    ws._isAlive = true;
    ws.on('pong', () => {
      ws._isAlive = true;
    });
    this.sockets.add(ws);
    this.closeIfRevokedSinceUpgrade(ws, req);
  }

  handleDisconnect(ws: ConferenceSocket): void {
    this.sockets.remove(ws);
    this.lifecycle.leave(ws);
  }

  closeSessionsFor(userId: string): number {
    return this.lifecycle.closeSessionsFor(userId);
  }

  @SubscribeMessage('conference.join')
  handleJoin(
    @ConnectedSocket() ws: ConferenceSocket,
    @MessageBody() body: unknown,
  ): Promise<void> {
    return this.lifecycle.join(ws, body);
  }

  @SubscribeMessage('conference.leave')
  handleLeave(@ConnectedSocket() ws: ConferenceSocket): void {
    this.lifecycle.leave(ws);
    sendEvent(ws, 'conference.leave', { left: true });
  }

  @SubscribeMessage('conference.transport.create')
  handleTransportCreate(
    @ConnectedSocket() ws: ConferenceSocket,
    @MessageBody() body: unknown,
  ): Promise<void> {
    return this.media.createTransport(ws, body);
  }

  @SubscribeMessage('conference.transport.connect')
  handleTransportConnect(
    @ConnectedSocket() ws: ConferenceSocket,
    @MessageBody() body: unknown,
  ): Promise<void> {
    return this.media.connectTransport(ws, body);
  }

  @SubscribeMessage('conference.produce')
  handleProduce(
    @ConnectedSocket() ws: ConferenceSocket,
    @MessageBody() body: unknown,
  ): Promise<void> {
    return this.media.produce(ws, body);
  }

  @SubscribeMessage('conference.consume')
  handleConsume(
    @ConnectedSocket() ws: ConferenceSocket,
    @MessageBody() body: unknown,
  ): Promise<void> {
    return this.media.consume(ws, body);
  }

  @SubscribeMessage('conference.consumer.resume')
  handleConsumerResume(
    @ConnectedSocket() ws: ConferenceSocket,
    @MessageBody() body: unknown,
  ): Promise<void> {
    return this.media.resumeConsumer(ws, body);
  }

  @SubscribeMessage('conference.participant.mute')
  handleParticipantMute(
    @ConnectedSocket() ws: ConferenceSocket,
    @MessageBody() body: unknown,
  ): Promise<void> {
    return this.media.setMuted(ws, body);
  }

  @SubscribeMessage('conference.participant.video')
  handleParticipantVideo(
    @ConnectedSocket() ws: ConferenceSocket,
    @MessageBody() body: unknown,
  ): Promise<void> {
    return this.media.setVideoEnabled(ws, body);
  }

  @SubscribeMessage('conference.translation.broadcast')
  handleTranslationBroadcast(
    @ConnectedSocket() ws: ConferenceSocket,
    @MessageBody() body: unknown,
  ): void {
    this.translation.relay(ws, body);
  }

  @SubscribeMessage('conference.chat')
  handleChat(
    @ConnectedSocket() ws: ConferenceSocket,
    @MessageBody() body: unknown,
  ): Promise<void> {
    return this.chat.send(ws, body);
  }

  /**
   * Re-check the token once the socket is registered, and close it if a reset
   * landed between the upgrade check and the registration — the same window
   * TranslateGateway closes, for the same reason: a reset that ran in it found
   * nothing to close.
   */
  private closeIfRevokedSinceUpgrade(ws: ConferenceSocket, req: unknown) {
    const token = tokenFromUpgradeRequest(req);
    if (token === null) return;
    this.auth.verifyToken(token).catch(() => {
      this.logger.warn(
        'closing a conference socket revoked during its upgrade',
      );
      try {
        ws.close(1008, 'Credentials changed');
      } catch {
        // Already gone.
      }
    });
  }
}
