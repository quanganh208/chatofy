import { Inject, Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { types } from 'mediasoup';
import { ConferenceRoomRegistry } from './conference-room-registry.service';
import type {
  ConferenceRoom,
  PeerState,
} from './conference-room-registry.service';
import {
  createVerifyClient,
  handleProtocols,
  tokenFromUpgradeRequest,
  VERIFIED_USER_ID,
} from '../translate/ws-auth';
import {
  AUTH_ADAPTER,
  type AuthAdapter,
} from '../auth/interfaces/auth-adapter.interface';

/**
 * Structural socket — avoids importing from 'ws' directly (same pattern as
 * StreamSocket in translate/session/stream-socket.ts).
 */
interface ConferenceSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  readyState: number;
  _userId?: string;
  _roomId?: string;
  _socketId?: string;
}

/** Announced IP for WebRTC candidates. Override with MEDIASOUP_ANNOUNCED_IP in prod. */
const ANNOUNCED_IP = process.env['MEDIASOUP_ANNOUNCED_IP'] ?? '127.0.0.1';

/**
 * TURN server config returned to clients along with transport params.
 *
 * mediasoup's server-side WebRtcTransport does NOT take iceServers — TURN is a
 * client-side concept. The server returns TURN credentials in the transport
 * create response so the client's mediasoup-client Device can relay through it.
 */
function turnIceServers(): {
  urls: string;
  username: string;
  credential: string;
}[] {
  const url = process.env['TURN_URL'];
  const username = process.env['TURN_USERNAME'];
  const credential = process.env['TURN_CREDENTIAL'];
  if (!url || !username || !credential) return [];
  return [{ urls: url, username, credential }];
}

async function makeWebRtcTransport(
  router: types.Router,
): Promise<types.WebRtcTransport> {
  return router.createWebRtcTransport({
    listenInfos: [
      { protocol: 'udp', ip: '0.0.0.0', announcedAddress: ANNOUNCED_IP },
    ],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
  });
}

@WebSocketGateway({ path: '/ws/conference' })
export class ConferenceGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  @WebSocketServer() private readonly server!: any;
  private readonly logger = new Logger(ConferenceGateway.name);

  constructor(
    private readonly rooms: ConferenceRoomRegistry,
    @Inject(AUTH_ADAPTER) private readonly auth: AuthAdapter,
  ) {}

  /**
   * Install upgrade-time auth (same pattern as TranslateGateway.afterInit).
   * Decorator options are evaluated at class definition time — before DI exists —
   * so verifyClient must be set here, after the adapter is injected.
   */
  afterInit(server: {
    options: { verifyClient?: unknown; handleProtocols?: unknown };
  }): void {
    server.options.verifyClient = createVerifyClient(
      (token) => this.auth.verifyToken(token),
      this.logger,
    );
    server.options.handleProtocols = handleProtocols;
  }

  handleConnection(ws: ConferenceSocket, req: Record<symbol, unknown>): void {
    const userId = req[VERIFIED_USER_ID];
    if (typeof userId !== 'string') {
      ws.close(1008, 'unauthorized');
      return;
    }
    ws._userId = userId;
    ws._socketId = crypto.randomUUID();
    this.logger.log(`Connected: ${ws._socketId} (user ${userId})`);
  }

  handleDisconnect(ws: ConferenceSocket): void {
    const { _socketId: sid, _roomId: roomId } = ws;
    if (!sid || !roomId) return;

    const room = this.rooms.getRoom(roomId);
    if (room) {
      this.broadcast(room, ws, {
        event: 'conference.peer.left',
        data: { socketId: sid },
      });
      this.rooms.removePeer(room, sid);
    }
    this.logger.log(`Disconnected: ${sid}`);
  }

  // ─── Signaling handlers ───────────────────────────────────────────────────

  @SubscribeMessage('conference.join')
  async handleJoin(
    @ConnectedSocket() ws: ConferenceSocket,
    @MessageBody() body: { roomId: string; displayName: string },
  ): Promise<void> {
    if (!ws._userId || !ws._socketId) {
      this.reply(ws, 'conference.join', { error: 'not_authenticated' });
      return;
    }
    try {
      ws._roomId = body.roomId;
      const room = await this.rooms.getOrCreateRoom(body.roomId);
      this.rooms.addPeer(room, ws._socketId, ws._userId, body.displayName);

      const existingPeers = [...room.peers.entries()]
        .filter(([sid]) => sid !== ws._socketId)
        .map(([sid, p]) => ({
          socketId: sid,
          displayName: p.displayName,
          userId: p.userId,
        }));

      this.broadcast(room, ws, {
        event: 'conference.peer.joined',
        data: {
          socketId: ws._socketId,
          displayName: body.displayName,
          userId: ws._userId,
        },
      });

      this.reply(ws, 'conference.join', {
        socketId: ws._socketId,
        rtpCapabilities: room.router.rtpCapabilities,
        peers: existingPeers,
      });
    } catch (err) {
      this.logger.error('handleJoin failed', err);
      this.reply(ws, 'conference.join', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  @SubscribeMessage('conference.transport.create')
  async handleTransportCreate(
    @ConnectedSocket() ws: ConferenceSocket,
    @MessageBody() body: { direction: 'send' | 'recv' },
  ): Promise<void> {
    const resolved = this.resolvePeer(ws);
    if ('error' in resolved) {
      this.reply(ws, 'conference.transport.create', resolved);
      return;
    }
    try {
      const { room, peer } = resolved;
      const transport = await makeWebRtcTransport(room.router);
      if (body.direction === 'send') peer.sendTransport = transport;
      else peer.recvTransport = transport;
      this.reply(ws, 'conference.transport.create', {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
        iceServers: turnIceServers(),
      });
    } catch (err) {
      this.logger.error('handleTransportCreate failed', err);
      this.reply(ws, 'conference.transport.create', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  @SubscribeMessage('conference.transport.connect')
  async handleTransportConnect(
    @ConnectedSocket() ws: ConferenceSocket,
    @MessageBody()
    body: { transportId: string; dtlsParameters: types.DtlsParameters },
  ): Promise<void> {
    const resolved = this.resolvePeer(ws);
    if ('error' in resolved) {
      this.reply(ws, 'conference.transport.connect', resolved);
      return;
    }
    try {
      const { peer } = resolved;
      const transport =
        peer.sendTransport?.id === body.transportId
          ? peer.sendTransport
          : peer.recvTransport?.id === body.transportId
            ? peer.recvTransport
            : null;
      if (!transport) {
        this.reply(ws, 'conference.transport.connect', {
          error: 'transport_not_found',
        });
        return;
      }
      await transport.connect({ dtlsParameters: body.dtlsParameters });
      this.reply(ws, 'conference.transport.connect', { connected: true });
    } catch (err) {
      this.logger.error('handleTransportConnect failed', err);
      this.reply(ws, 'conference.transport.connect', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  @SubscribeMessage('conference.produce')
  async handleProduce(
    @ConnectedSocket() ws: ConferenceSocket,
    @MessageBody()
    body: {
      kind: types.MediaKind;
      rtpParameters: types.RtpParameters;
      appData?: Record<string, unknown>;
    },
  ): Promise<void> {
    const resolved = this.resolvePeer(ws);
    if ('error' in resolved) {
      this.reply(ws, 'conference.produce', resolved);
      return;
    }
    try {
      const { room, peer } = resolved;
      if (!peer.sendTransport) {
        this.reply(ws, 'conference.produce', { error: 'no_send_transport' });
        return;
      }
      const producer = await peer.sendTransport.produce({
        kind: body.kind,
        rtpParameters: body.rtpParameters,
        appData: body.appData ?? {},
      });
      peer.producers.set(producer.id, producer);
      this.broadcast(room, ws, {
        event: 'conference.new.producer',
        data: {
          producerId: producer.id,
          socketId: ws._socketId,
          kind: producer.kind,
          appData: producer.appData,
        },
      });
      this.reply(ws, 'conference.produce', { id: producer.id });
    } catch (err) {
      this.logger.error('handleProduce failed', err);
      this.reply(ws, 'conference.produce', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  @SubscribeMessage('conference.consume')
  async handleConsume(
    @ConnectedSocket() ws: ConferenceSocket,
    @MessageBody()
    body: {
      producerId: string;
      rtpCapabilities: types.RtpCapabilities;
    },
  ): Promise<void> {
    const resolved = this.resolvePeer(ws);
    if ('error' in resolved) {
      this.reply(ws, 'conference.consume', resolved);
      return;
    }
    try {
      const { room, peer } = resolved;
      if (!peer.recvTransport) {
        this.reply(ws, 'conference.consume', { error: 'no_recv_transport' });
        return;
      }
      if (
        !room.router.canConsume({
          producerId: body.producerId,
          rtpCapabilities: body.rtpCapabilities,
        })
      ) {
        this.reply(ws, 'conference.consume', { error: 'cannot_consume' });
        return;
      }
      const consumer = await peer.recvTransport.consume({
        producerId: body.producerId,
        rtpCapabilities: body.rtpCapabilities,
        paused: true,
      });
      peer.consumers.set(consumer.id, consumer);
      this.reply(ws, 'conference.consume', {
        id: consumer.id,
        producerId: body.producerId,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
      });
    } catch (err) {
      this.logger.error('handleConsume failed', err);
      this.reply(ws, 'conference.consume', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  @SubscribeMessage('conference.translation.broadcast')
  handleTranslationBroadcast(
    @ConnectedSocket() ws: ConferenceSocket,
    @MessageBody() body: { subtitle?: unknown; audio?: unknown },
  ): void {
    const resolved = this.resolvePeer(ws);
    if ('error' in resolved) return;
    // Fan out subtitle and audio sub-objects as separate events so listeners
    // can handle each independently without parsing the combined envelope.
    if (body.subtitle) {
      this.broadcast(resolved.room, ws, {
        event: 'conference.translation.subtitle',
        data: body.subtitle,
      });
    }
    if (body.audio) {
      this.broadcast(resolved.room, ws, {
        event: 'conference.translation.audio',
        data: body.audio,
      });
    }
  }

  @SubscribeMessage('conference.consumer.resume')
  async handleConsumerResume(
    @ConnectedSocket() ws: ConferenceSocket,
    @MessageBody() body: { consumerId: string },
  ): Promise<void> {
    const resolved = this.resolvePeer(ws);
    if ('error' in resolved) {
      this.reply(ws, 'conference.consumer.resume', resolved);
      return;
    }
    try {
      const { peer } = resolved;
      const consumer = peer.consumers.get(body.consumerId);
      if (!consumer) {
        this.reply(ws, 'conference.consumer.resume', {
          error: 'consumer_not_found',
        });
        return;
      }
      await consumer.resume();
      this.reply(ws, 'conference.consumer.resume', { resumed: true });
    } catch (err) {
      this.logger.error('handleConsumerResume failed', err);
      this.reply(ws, 'conference.consumer.resume', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private reply(ws: ConferenceSocket, event: string, data: unknown): void {
    ws.send(JSON.stringify({ event, data }));
  }

  private resolvePeer(
    ws: ConferenceSocket,
  ): { room: ConferenceRoom; peer: PeerState } | { error: string } {
    const { _socketId: sid, _roomId: roomId } = ws;
    if (!sid || !roomId) return { error: 'not_in_room' };

    const room = this.rooms.getRoom(roomId);
    if (!room) return { error: 'room_not_found' };

    const peer = room.peers.get(sid);
    if (!peer) return { error: 'peer_not_found' };

    return { room, peer };
  }

  private broadcast(
    room: ConferenceRoom,
    exclude: ConferenceSocket,
    message: object,
  ): void {
    const payload = JSON.stringify(message);
    // server.clients is a Set<WebSocket>; typed as any to avoid the ws import.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.server.clients as Set<any>).forEach((client: ConferenceSocket) => {
      if (
        client !== exclude &&
        client._roomId === room.id &&
        client.readyState === 1
      ) {
        client.send(payload);
      }
    });
  }
}
