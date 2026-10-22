import { createHmac } from 'crypto';
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
  ParticipantSession,
} from './conference-room-registry.service';
import { ConferenceMetricsService } from './conference-metrics.service';
import { ConferencePersistenceService } from './services/conference-persistence.service';
import { ConferenceService } from './conference.service';
import { ConferenceTranslationRouter } from './services/conference-translation-router.service';
import { PipelineTranslatorService } from '../translate/services/pipeline-translator.service';
import { LANGUAGE_CODES, type LanguageCode } from '@chatofy/types';
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
 *
 * coturn runs with --use-auth-secret (TURN REST API). Credentials must be:
 *   username = "${expiry_unix_ts}:${userId}"
 *   password = base64(HMAC-SHA1(COTURN_SECRET, username))
 */
function turnIceServers(
  userId: string,
): { urls: string; username: string; credential: string }[] {
  const url = process.env['TURN_URL'];
  const secret = process.env['COTURN_SECRET'];
  if (!url || !secret) return [];

  const expiry = Math.floor(Date.now() / 1000) + 3600;
  const username = `${expiry}:${userId}`;
  const credential = createHmac('sha1', secret)
    .update(username)
    .digest('base64');
  return [{ urls: url, username, credential }];
}

async function makeWebRtcTransport(
  router: types.Router,
): Promise<types.WebRtcTransport> {
  return router.createWebRtcTransport({
    listenInfos: [
      { protocol: 'udp', ip: '0.0.0.0', announcedAddress: ANNOUNCED_IP },
      { protocol: 'tcp', ip: '0.0.0.0', announcedAddress: ANNOUNCED_IP },
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
    private readonly metrics: ConferenceMetricsService,
    private readonly persistence: ConferencePersistenceService,
    private readonly translationRouter: ConferenceTranslationRouter,
    private readonly translator: PipelineTranslatorService,
    @Inject(AUTH_ADAPTER) private readonly auth: AuthAdapter,
    private readonly conferenceService: ConferenceService,
  ) {}

  /**
   * Install upgrade-time auth (same pattern as TranslateGateway.afterInit).
   * Decorator options are evaluated at class definition time — before DI exists —
   * so verifyClient must be set here, after the adapter is injected.
   */
  afterInit(server: {
    options: { verifyClient?: unknown; handleProtocols?: unknown };
    clients: Set<ConferenceSocket & { isAlive?: boolean }>;
    on(event: string, cb: () => void): void;
  }): void {
    server.options.verifyClient = createVerifyClient(
      (token) => this.auth.verifyToken(token),
      this.logger,
    );
    server.options.handleProtocols = handleProtocols;

    // Heartbeat: evict ghost peers that stop responding to pings.
    const PING_INTERVAL_MS = 30_000;
    const pingInterval = setInterval(() => {
      server.clients.forEach((ws) => {
        if (ws.isAlive === false) {
          ws.close(1001, 'heartbeat timeout');
          return;
        }
        ws.isAlive = false;
        (ws as unknown as { ping(): void }).ping();
      });
    }, PING_INTERVAL_MS);

    server.on('close', () => {
      clearInterval(pingInterval);
    });
  }

  handleConnection(ws: ConferenceSocket, req: Record<symbol, unknown>): void {
    const userId = req[VERIFIED_USER_ID];
    if (typeof userId !== 'string') {
      ws.close(1008, 'unauthorized');
      return;
    }
    ws._userId = userId;
    ws._socketId = crypto.randomUUID();

    // Mark alive on connect; update on every pong so the heartbeat doesn't evict active peers.
    (ws as ConferenceSocket & { isAlive?: boolean }).isAlive = true;
    (ws as unknown as { on(event: string, cb: () => void): void }).on(
      'pong',
      () => {
        (ws as ConferenceSocket & { isAlive?: boolean }).isAlive = true;
      },
    );

    this.logger.log(`Connected: ${ws._socketId} (user ${userId})`);
  }

  handleDisconnect(ws: ConferenceSocket): void {
    const { _socketId: sid, _roomId: roomId, _userId: userId } = ws;
    if (!sid || !roomId) return;

    const room = this.rooms.getRoom(roomId);
    if (room) {
      this.broadcast(room, ws, {
        event: 'conference.peer.left',
        data: { socketId: sid },
      });
      this.rooms.removePeer(room, sid);
    }

    // Persist leave — fire-and-forget; errors are logged inside the service.
    if (userId) {
      void this.persistence.recordLeave(roomId, userId);
    }

    this.logger.log(`Disconnected: ${sid}`);
  }

  // ─── Signaling handlers ───────────────────────────────────────────────────

  @SubscribeMessage('conference.join')
  async handleJoin(
    @ConnectedSocket() ws: ConferenceSocket,
    @MessageBody()
    body: { roomId: string; displayName: string; sourceLanguage?: string },
  ): Promise<void> {
    if (!ws._userId || !ws._socketId) {
      this.reply(ws, 'conference.join', { error: 'not_authenticated' });
      return;
    }
    try {
      ws._roomId = body.roomId;
      const room = await this.rooms.getOrCreateRoom(body.roomId);

      // Evict any stale peer from the same user (e.g. page reload / navigation-away rejoin).
      for (const [staleSid, stalePeer] of room.peers) {
        if (stalePeer.userId === ws._userId) {
          this.broadcast(room, ws, {
            event: 'conference.peer.left',
            data: { socketId: staleSid },
          });
          this.rooms.removePeer(room, staleSid);
          this.logger.log(
            `Evicted stale peer ${staleSid} for user ${ws._userId}`,
          );
        }
      }

      this.rooms.addPeer(
        room,
        ws._socketId,
        ws._userId,
        body.displayName,
        body.sourceLanguage ?? 'vi',
      );

      // Persist join and cache participantId for later subtitle turns.
      void this.persistence
        .recordJoin(
          body.roomId,
          ws._userId,
          body.displayName,
          body.sourceLanguage ?? 'vi',
        )
        .then((participantId) => {
          const p = room.peers.get(ws._socketId!);
          if (p) p.participantId = participantId;
        })
        .catch((err: unknown) => this.logger.error('recordJoin failed', err));

      const existingPeers = [...room.peers.entries()]
        .filter(([sid]) => sid !== ws._socketId)
        .map(([sid, p]) => ({
          socketId: sid,
          displayName: p.displayName,
          userId: p.userId,
          // `conference.new.producer` only reaches peers already in the room, so a
          // late joiner learns about earlier tracks from this list or never at all.
          producers: [...p.producers.values()].map((producer) => ({
            producerId: producer.id,
            kind: producer.kind,
          })),
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
        iceServers: turnIceServers(ws._userId ?? 'anonymous'),
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

  private static readonly MAX_PRODUCERS_PER_PEER = 2;

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
      if (peer.producers.size >= ConferenceGateway.MAX_PRODUCERS_PER_PEER) {
        this.reply(ws, 'conference.produce', {
          error: 'producer_limit_reached',
        });
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
    @MessageBody()
    body: {
      subtitle?: {
        speakerSocketId?: string;
        speakerDisplayName?: string;
        sourceLanguage?: string;
        sourceText?: string;
        searchText?: string;
        translations?: Record<string, unknown>;
        audioStartMs?: number;
        audioDurationMs?: number;
        [k: string]: unknown;
      };
      audio?: unknown;
    },
  ): void {
    const resolved = this.resolvePeer(ws);
    if ('error' in resolved) return;
    const { room } = resolved;

    // Fan out subtitle and audio via the router (self-filter + language routing).
    if (body.subtitle) {
      // Overwrite client-supplied identity fields with server-authoritative values
      // to prevent a peer from spoofing another participant's subtitles.
      const serverSubtitle: typeof body.subtitle & Record<string, unknown> = {
        ...body.subtitle,
        speakerSocketId: ws._socketId!,
        speakerDisplayName: resolved.peer.displayName,
      };
      this.translationRouter.routeSubtitle(
        room,
        ws._socketId!,
        serverSubtitle,
        (socketId, event, data) =>
          this.broadcastToSocket(socketId, event, data),
      );

      // Only persist final subtitle frames — partial frames skip the DB write.
      const sub = serverSubtitle;
      if (
        sub.isFinal &&
        ws._roomId &&
        ws._userId &&
        typeof sub.sourceLanguage === 'string' &&
        typeof sub.sourceText === 'string'
      ) {
        const participantId = resolved.peer.participantId;
        if (participantId) {
          void this.persistence
            .recordTurn(participantId, ws._roomId, {
              sourceLanguage: sub.sourceLanguage,
              sourceText: sub.sourceText,
              searchText: sub.searchText,
              translations: sub.translations,
              audioStartMs: sub.audioStartMs,
              audioDurationMs: sub.audioDurationMs,
            })
            .catch((err: unknown) =>
              this.logger.error('recordTurn failed', err),
            );
        } else {
          this.logger.debug(
            `recordTurn skipped — participantId not yet resolved for ${ws._socketId} in ${ws._roomId}`,
          );
        }
      }
    }
    if (body.audio) {
      this.translationRouter.routeAudio(
        room,
        ws._socketId!,
        body.audio,
        (socketId, event, data) =>
          this.broadcastToSocket(socketId, event, data),
      );
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

  @SubscribeMessage('conference.participant.mute')
  handleParticipantMute(
    @ConnectedSocket() ws: ConferenceSocket,
    @MessageBody() body: { muted: boolean },
  ): void {
    const resolved = this.resolvePeer(ws);
    if ('error' in resolved) {
      this.reply(ws, 'conference.participant.mute', resolved);
      return;
    }
    const { room, peer } = resolved;
    peer.muted = body.muted;
    this.broadcast(room, ws, {
      event: 'conference.participant.state',
      data: {
        socketId: ws._socketId,
        muted: peer.muted,
        videoEnabled: peer.videoEnabled,
      },
    });
    this.reply(ws, 'conference.participant.mute', { muted: peer.muted });
  }

  /**
   * In-meeting text chat, translated per recipient.
   *
   * One sent message is translated into every distinct recipient language in
   * the room and fanned out per peer; a recipient sharing the sender's language
   * gets the original text, and the sender gets an echo of their own original.
   * Ephemeral — nothing is persisted. If translation throws (provider hiccup),
   * everyone receives the original text so chat never breaks.
   */
  @SubscribeMessage('conference.chat')
  async handleChat(
    @ConnectedSocket() ws: ConferenceSocket,
    @MessageBody() body: { text: string },
  ): Promise<void> {
    const resolved = this.resolvePeer(ws);
    if ('error' in resolved) {
      this.reply(ws, 'conference.chat.message', resolved);
      return;
    }
    const { room, peer } = resolved;

    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    if (!text) return;

    const MAX_CHAT_TEXT_LENGTH = 2000;
    if (text.length > MAX_CHAT_TEXT_LENGTH) {
      this.reply(ws, 'conference.chat.message', { error: 'text_too_long' });
      return;
    }

    const senderSocketId = ws._socketId!;
    const senderDisplayName = peer.displayName;
    const senderLang = this.toLanguageCode(peer.sourceLanguage);
    const id = crypto.randomUUID();
    const sentAt = Date.now();

    // Echo the original to the sender in their own language.
    this.reply(ws, 'conference.chat.message', {
      id,
      socketId: senderSocketId,
      displayName: senderDisplayName,
      text,
      lang: senderLang,
      sentAt,
    });

    // Other peers in the room (exclude the sender).
    const recipients = [...room.peers.entries()].filter(
      ([sid]) => sid !== senderSocketId,
    );
    if (recipients.length === 0) return;

    // Distinct recipient languages that differ from the sender's.
    const targets = [
      ...new Set(
        recipients
          .map(([, p]) => this.toLanguageCode(p.sourceLanguage))
          .filter((lang) => lang !== senderLang),
      ),
    ];

    // text keyed by target language; the sender's language maps to the original.
    const byLang = new Map<LanguageCode, string>([[senderLang, text]]);
    if (targets.length > 0) {
      try {
        const translations = await this.translator.translateAll({
          text,
          source: senderLang,
          targets,
        });
        for (const target of targets) {
          byLang.set(target, translations[target] ?? text);
        }
      } catch (err) {
        // Provider hiccup: degrade to the original for every target. Chat must
        // not break on a translation failure.
        this.logger.error('conference.chat translateAll failed', err);
        for (const target of targets) byLang.set(target, text);
      }
    }

    for (const [sid, p] of recipients) {
      const recipientLang = this.toLanguageCode(p.sourceLanguage);
      this.broadcastToSocket(sid, 'conference.chat.message', {
        id,
        socketId: senderSocketId,
        displayName: senderDisplayName,
        text: byLang.get(recipientLang) ?? text,
        lang: recipientLang,
        sentAt,
      });
    }
  }

  @SubscribeMessage('conference.participant.video')
  handleParticipantVideo(
    @ConnectedSocket() ws: ConferenceSocket,
    @MessageBody() body: { videoEnabled: boolean },
  ): void {
    const resolved = this.resolvePeer(ws);
    if ('error' in resolved) {
      this.reply(ws, 'conference.participant.video', resolved);
      return;
    }
    const { room, peer } = resolved;
    peer.videoEnabled = body.videoEnabled;
    this.broadcast(room, ws, {
      event: 'conference.participant.state',
      data: {
        socketId: ws._socketId,
        muted: peer.muted,
        videoEnabled: peer.videoEnabled,
      },
    });
    this.reply(ws, 'conference.participant.video', {
      videoEnabled: peer.videoEnabled,
    });
  }

  @SubscribeMessage('conference.leave')
  handleLeave(@ConnectedSocket() ws: ConferenceSocket): void {
    const { _socketId: sid, _roomId: roomId, _userId: userId } = ws;
    if (sid && roomId) {
      const room = this.rooms.getRoom(roomId);
      if (room) {
        this.broadcast(room, ws, {
          event: 'conference.peer.left',
          data: { socketId: sid },
        });
        this.rooms.removePeer(room, sid);
      }
      if (userId) {
        void this.persistence.recordLeave(roomId, userId);
      }
      // Clear room association but keep socket open.
      ws._roomId = undefined;
      this.logger.log(`Explicit leave: ${sid}`);
    }
    this.reply(ws, 'conference.leave', { left: true });
  }

  // ─── Metrics (benchmark only, gated by CONFERENCE_METRICS_ENABLED=1) ─────

  @SubscribeMessage('conference.metrics')
  handleMetrics(@ConnectedSocket() ws: ConferenceSocket): void {
    if (!this.metrics.isEnabled()) {
      this.reply(ws, 'conference.metrics', { error: 'metrics_not_enabled' });
      return;
    }
    const snapshot = this.metrics.getSnapshot();
    this.reply(
      ws,
      'conference.metrics',
      snapshot ?? { error: 'no_snapshot_yet' },
    );
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private reply(ws: ConferenceSocket, event: string, data: unknown): void {
    ws.send(JSON.stringify({ event, data }));
  }

  /**
   * Narrow a peer's declared `sourceLanguage` string to a `LanguageCode`,
   * falling back to the first supported code for an unknown value so chat
   * translation never crashes on a malformed join language.
   */
  private toLanguageCode(lang: string): LanguageCode {
    return (LANGUAGE_CODES as readonly string[]).includes(lang)
      ? (lang as LanguageCode)
      : LANGUAGE_CODES[0];
  }

  private resolvePeer(
    ws: ConferenceSocket,
  ): { room: ConferenceRoom; peer: ParticipantSession } | { error: string } {
    const { _socketId: sid, _roomId: roomId } = ws;
    if (!sid || !roomId) return { error: 'not_in_room' };

    const room = this.rooms.getRoom(roomId);
    if (!room) return { error: 'room_not_found' };

    const peer = room.peers.get(sid);
    if (!peer) return { error: 'peer_not_found' };

    return { room, peer };
  }

  /**
   * Send an event to exactly one socket identified by socketId.
   * Used by ConferenceTranslationRouter's broadcast callback.
   */
  private broadcastToSocket(
    socketId: string,
    event: string,
    data: unknown,
  ): void {
    const payload = JSON.stringify({ event, data });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.server.clients as Set<any>).forEach((client: ConferenceSocket) => {
      if (client._socketId === socketId && client.readyState === 1) {
        client.send(payload);
      }
    });
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
