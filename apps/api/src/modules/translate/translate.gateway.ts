import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  type OnGatewayDisconnect,
} from '@nestjs/websockets';
import {
  clientEventSchema,
  liveClientEventSchema,
  type ClientEvent,
  type LiveClientEvent,
  type LiveServerEvent,
  type ServerEvent,
} from '@chatofy/types';
import { parseWsEvent } from './parse-ws-event';
import { TranslationSessionService } from './services/translation-session.service';
import { LiveTranslateSessionService } from './services/live-translate-session.service';
import type { StreamSocket } from './session/stream-socket';

/** Which family of messages a connection has committed to. */
type ConnectionMode = 'turn' | 'live';

/**
 * WebSocket gateway for real-time translation.
 * Path: /ws/translate — matched by WsAdapter registered in main.ts.
 *
 * ONE path, TWO modes. The path names the service; the first message names the
 * mode. A client that sends `client.session.start` gets the turn-based cascade
 * (STT → translate → TTS); one that sends `client.live.start` gets continuous
 * speech-to-speech through a single upstream session.
 *
 * The two families keep SEPARATE zod unions — `clientEventSchema` and
 * `liveClientEventSchema` — and they are not merged. Nest dispatches on the
 * message `type`, and the two namespaces are already disjoint, so sharing a path
 * costs the turn contract nothing: it is validated by the web app and the
 * extension, and a branch inside it would hand both of them a shape they never
 * asked for.
 *
 * Both families live in ONE class rather than two gateways bound to the same
 * path. Two would bind — Nest caches the server by `{port, path}` — but the
 * WsAdapter attaches a `message` listener per gateway, so every frame would be
 * JSON-parsed twice and would additionally throw and swallow a TypeError in
 * whichever gateway does not own that event. That cost lands on the audio hot
 * path, which is the thing being measured.
 *
 * This class is transport only — it validates payloads and hands them to the
 * session services, which own the per-connection state machines. Replies are
 * pushed onto the socket by those services rather than returned from these
 * handlers, because one turn, and one live session, each emit several events
 * over their life.
 */
@WebSocketGateway({ path: '/ws/translate' })
export class TranslateGateway implements OnGatewayDisconnect {
  private readonly logger = new Logger(TranslateGateway.name);

  /**
   * The mode each connection committed to, claimed by its first start message.
   *
   * A socket that held a turn AND a live session at once would take a slot in
   * two independent concurrency counters and would receive interleaved event
   * families, which its own client-side `safeParse` rejects as "unexpected event
   * shape" — a self-inflicted error storm with a misleading message, on an
   * endpoint that takes no authentication.
   *
   * Held for the connection's life rather than released when a session ends,
   * because the gateway cannot observe a session ending: a live session can
   * close from the idle sweep, the byte ceiling, or the upstream's own socket,
   * and none of those has a gateway frame in the stack. Releasing would mean new
   * API on both services to enable a switch no client performs — each opens one
   * socket per direction or per page. A client that ever needs to switch opens a
   * second connection.
   *
   * Keyed weakly, so an entry cannot outlive the socket it describes.
   */
  private readonly modes = new WeakMap<StreamSocket, ConnectionMode>();

  constructor(
    private readonly sessions: TranslationSessionService,
    private readonly live: LiveTranslateSessionService,
  ) {}

  /**
   * Commit a connection to one message family, or refuse a start that crosses.
   *
   * Guards START messages only. A frame arriving for the other family is
   * already answered by the service that owns it — an unknown turn, or
   * `no_live_session` — and adding a lookup to the frame path would cost the
   * audio hot path for no behavioural gain.
   *
   * A SECOND start of the same family is normal and must pass: a socket may hold
   * several turns at once (`MAX_CONCURRENT_TURNS_PER_SOCKET` in
   * `session/turn-concurrency.ts`), which is exactly what the extension does. A
   * second live start also passes here and is refused downstream by the live
   * service's own one-session-per-connection rule, which already reports it.
   *
   * Note the claim survives a start the SERVICE then refuses — a turn rejected
   * at the concurrency ceiling still commits the connection to `turn`. That
   * follows from the claim being connection-scoped rather than session-scoped,
   * and costs nothing: a client that could not open a turn has no reason to
   * switch families instead.
   */
  private claimMode(
    client: StreamSocket,
    mode: ConnectionMode,
    turnId?: string,
  ): boolean {
    const held = this.modes.get(client);
    if (held === undefined) {
      this.modes.set(client, mode);
      return true;
    }
    if (held === mode) return true;

    this.logger.warn(
      `Rejected a ${mode} start on a connection already serving ${held}`,
    );
    // Reported as a contract event, NOT as a WsException. A throw from here
    // reaches the client as nothing at all — measured: the adapter swallows it
    // and the socket simply goes quiet, which reads as a hung session. Every
    // refusal a client is meant to act on travels the same way the services'
    // own refusals do.
    //
    // Phrased in the vocabulary of the family being refused, because that is
    // the union this client validates against: a live client cannot parse a
    // `server.error`, and a turn client cannot parse a `server.live.error`.
    const message = `This connection is already running a ${held} session; open a second connection for ${mode}`;
    this.emit(
      client,
      mode === 'live'
        ? { type: 'server.live.error', code: 'mode_conflict', message }
        : // `turnId` carried back because this refusal happens before any
          // server id exists, and the client's own name is then the only one
          // there is. Without it an ordered playback queue that has reserved a
          // slot for this turn waits on it forever.
          { type: 'server.error', code: 'mode_conflict', message, turnId },
    );
    return false;
  }

  /** Push one contract event, never letting a dead socket take the process down. */
  private emit(
    client: StreamSocket,
    event: ServerEvent | LiveServerEvent,
  ): void {
    try {
      client.send(JSON.stringify(event));
    } catch (err) {
      this.logger.warn(
        `dropped ${event.type}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  @SubscribeMessage('client.session.start')
  handleSessionStart(
    @MessageBody() payload: unknown,
    @ConnectedSocket() client: StreamSocket,
  ): void {
    const {
      type: _type,
      turnId,
      ...options
    } = this.parseEvent(payload, 'client.session.start');
    if (!this.claimMode(client, 'turn', turnId)) return;
    // `turnId` and the discriminator travel beside the options rather than
    // inside them: `turnId` names the turn, it is not a translation setting, and
    // widening `sessionOptionsSchema` would drag it through every layer that
    // rebuilds that object.
    //
    // The rest is passed through as a whole rather than rebuilt field by field.
    // Rebuilding is how a new session option dies here: it parses, it defaults,
    // and then it is silently dropped on this line while every test below the
    // gateway still passes because they construct the options themselves. The
    // spread makes the schema the single place a setting has to be declared.
    this.sessions.start(client, options, turnId);
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
    const { sessionId } = this.parseEvent(payload, 'client.turn.speculate');
    this.sessions.speculate(client, sessionId);
  }

  @SubscribeMessage('client.session.end')
  handleSessionEnd(
    @MessageBody() payload: unknown,
    @ConnectedSocket() client: StreamSocket,
  ): Promise<void> {
    const { sessionId } = this.parseEvent(payload, 'client.session.end');
    return this.sessions.end(client, sessionId);
  }

  /**
   * Timings only the client could have measured, for one of its own turns.
   *
   * Fire-and-forget like the rest of this path: measurements must never be able to
   * fail the turn they describe.
   */
  @SubscribeMessage('client.turn.metrics')
  handleTurnMetrics(
    @MessageBody() payload: unknown,
    @ConnectedSocket() client: StreamSocket,
  ): void {
    const { type: _type, ...metrics } = this.parseEvent(
      payload,
      'client.turn.metrics',
    );
    this.sessions.recordClientMetrics(client, metrics);
  }

  // ── Continuous speech-to-speech ───────────────────────────────────────────
  // A separate union and a separate state machine, sharing only this path.

  @SubscribeMessage('client.live.start')
  handleLiveStart(
    @MessageBody() payload: unknown,
    @ConnectedSocket() client: StreamSocket,
  ): Promise<void> {
    const { direction } = this.parseLiveEvent(payload, 'client.live.start');
    if (!this.claimMode(client, 'live')) return Promise.resolve();
    return this.live.start(client, direction);
  }

  @SubscribeMessage('client.live.audio')
  handleLiveAudio(
    @MessageBody() payload: unknown,
    @ConnectedSocket() client: StreamSocket,
  ): Promise<void> {
    const event = this.parseLiveEvent(payload, 'client.live.audio');
    return this.live.pushFrame(client, event.frame);
  }

  @SubscribeMessage('client.live.stop')
  handleLiveStop(
    @MessageBody() payload: unknown,
    @ConnectedSocket() client: StreamSocket,
  ): Promise<void> {
    this.parseLiveEvent(payload, 'client.live.stop');
    return this.live.stop(client, 'client_stopped');
  }

  /**
   * Free everything a dropped socket was holding — turns AND any live session.
   *
   * Both are called unconditionally rather than switched on the claimed mode.
   * Each is already a no-op for a socket it does not know, and a branch here
   * would be a way to leak: if the live cleanup were skipped, nothing would
   * fail, no test would hang and nothing would be logged — the idle sweep would
   * reclaim the session much later, leaving the upstream socket metered for the
   * whole window on every dropped connection.
   */
  handleDisconnect(client: StreamSocket): void {
    // The live half goes first and the rest sits in `finally`, so no cleanup can
    // be skipped by an earlier one throwing. Nothing throws today; the ordering
    // is free, and the failure it guards against is invisible — a skipped live
    // stop logs nothing and fails no test, it just leaves a metered upstream
    // socket open until the idle sweep notices 30 s later.
    try {
      void this.live.stop(client, 'disconnected');
      this.sessions.disconnect(client);
    } finally {
      this.modes.delete(client);
    }
  }

  /**
   * Validate an incoming message body against the shared contract and narrow it
   * to the event type this handler subscribed to.
   */
  private parseEvent<T extends ClientEvent['type']>(
    payload: unknown,
    type: T,
  ): Extract<ClientEvent, { type: T }> {
    return parseWsEvent(clientEventSchema, payload, type, this.logger);
  }

  /** The same validation against the continuous path's own contract. */
  private parseLiveEvent<T extends LiveClientEvent['type']>(
    payload: unknown,
    type: T,
  ): Extract<LiveClientEvent, { type: T }> {
    return parseWsEvent(liveClientEventSchema, payload, type, this.logger);
  }
}
