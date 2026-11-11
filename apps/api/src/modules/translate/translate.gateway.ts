import { Inject, Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  type OnGatewayInit,
} from '@nestjs/websockets';
import {
  clientEventSchema,
  type ClientEvent,
  type ServerEvent,
} from '@chatofy/types';
import {
  AUTH_ADAPTER,
  type AuthAdapter,
} from '../auth/interfaces/auth-adapter.interface';
import { SessionTerminator } from '../auth/session-terminator';
import type { TerminableTransport } from '../auth/session-terminator';
import { parseWsEvent } from './parse-ws-event';
import {
  createVerifyClient,
  handleProtocols,
  tokenFromUpgradeRequest,
  verifiedUserId,
} from './ws-auth';
import { TranslationSessionService } from './services/translation-session.service';
import type { StreamSocket } from './session/stream-socket';
import {
  SocketResumeRegistry,
  resumeKeyFrom,
} from './session/socket-resume-registry';
import { llmCallScope } from '../usage/llm-call-scope';
import { creditMultiplier } from '../credits/credit-pricing';
import {
  languagesAStartMaySpeak,
  resolveLanguageVoice,
} from './session/language-voice';
import {
  MESSAGES as CREDIT_MESSAGES,
  TranslationMeter,
  type CreditStopReason,
} from '../credits/translation-meter';

/**
 * A socket this gateway can end.
 *
 * Structural, like `StreamSocket`, so the registry stays testable with a
 * two-line fake rather than a real `ws` server. `close` is optional because
 * `StreamSocket` does not promise it — a fake that only sends is still a valid
 * socket everywhere else in this file.
 */
type CloseableSocket = StreamSocket & {
  close?: (code?: number, reason?: string) => void;
  terminate?: () => void;
  ping?: () => void;
  on?: (event: 'pong', listener: () => void) => void;
};

/**
 * How often every socket is pinged; one missed pong ends it at the next tick.
 *
 * Half of the conference gateway's 30 s: detection takes up to two intervals,
 * and a socket that died without a close (2026-11-11, browser↔edge) otherwise
 * keeps translating into nothing, holding its turns and its credit lease until
 * the 30 s idle sweep reaches each turn.
 */
const PING_INTERVAL_MS = 15_000;

/**
 * How long a cleanly closed socket's conversation history waits for the client
 * to reconnect with the same `resume` key. Covers the client's whole retry
 * schedule (about 6 s) with room for a slow handshake.
 */
const RESUME_PARK_MS = 30_000;

/**
 * WebSocket gateway for real-time translation.
 * Path: /ws/translate — matched by WsAdapter registered in main.ts.
 *
 * `client.session.start` opens a turn of the cascade (STT → translate → TTS).
 *
 * This class is transport only — it validates payloads and hands them to the
 * session service, which owns the per-connection state machine. Replies are
 * pushed onto the socket by that service rather than returned from these
 * handlers, because one turn emits several events over its life.
 */
@WebSocketGateway({ path: '/ws/translate' })
export class TranslateGateway
  implements
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnGatewayInit,
    TerminableTransport
{
  private readonly logger = new Logger(TranslateGateway.name);

  /**
   * Who each open socket belongs to, so a completed password reset can close
   * them.
   *
   * A STRONG map, keyed by user to the set of their sockets. Weak keys would
   * defeat the purpose: the whole job is to hold a reference long enough to
   * close it on demand. Entries are removed in `handleDisconnect`, and the
   * user's entry is dropped when their last socket goes, so an account that
   * comes and goes leaves nothing behind.
   */
  private readonly socketsByUser = new Map<string, Set<CloseableSocket>>();
  /**
   * The owner of each socket, looked up the other way round.
   *
   * `socketsByUser` answers "which sockets does this person hold", which is what
   * a revocation needs. Metering needs the reverse — "who is spending" — and
   * scanning the map for every turn start would be answering a question the
   * upgrade already knew. Weak so a closed socket takes its entry with it.
   */
  private readonly userBySocket = new WeakMap<CloseableSocket, string>();
  /**
   * Each socket's starts, run one after another. Admission awaits the ledger,
   * and two starts must still open in the order they arrived: the server names
   * a turn's predecessor by that order.
   */
  private readonly startChains = new WeakMap<StreamSocket, Promise<void>>();
  /** Whether each socket answered the last ping; see `PING_INTERVAL_MS`. */
  private readonly alive = new WeakMap<CloseableSocket, boolean>();
  /**
   * Sockets whose disconnect has already run. A supersede runs it early and
   * then ends the socket, and `ws` reports that end as a second disconnect.
   */
  private readonly disconnected = new WeakSet<CloseableSocket>();
  /** Sockets that already sent their `client.connection.report`. */
  private readonly reported = new WeakSet<StreamSocket>();
  /**
   * Each disconnected socket's lease close, still settling. A reconnect's
   * starts wait on its predecessor's: the reservation the old lease holds is
   * only returned once this settles, and a low balance would otherwise refuse
   * the first start on the new socket.
   */
  private readonly leaseClosing = new WeakMap<CloseableSocket, Promise<void>>();
  /** Which socket carries each resumable conversation; see the class. */
  private readonly resumable = new SocketResumeRegistry<CloseableSocket>(
    RESUME_PARK_MS,
    (socket) => this.sessions.forgetConversation(socket),
  );

  constructor(
    private readonly sessions: TranslationSessionService,
    @Inject(AUTH_ADAPTER) private readonly auth: AuthAdapter,
    private readonly terminator: SessionTerminator,
    private readonly meter: TranslationMeter,
  ) {
    // The gateway registers ITSELF. Auth never names a gateway, a socket, or
    // `ws` — it asks for a user's live connections to end and this answers.
    this.terminator.register(this);
  }

  /**
   * Installs the upgrade-time auth check on the server the adapter built.
   *
   * Set here rather than passed through @WebSocketGateway's options because
   * decorator arguments are evaluated when this class is DEFINED — long before
   * a DI container exists to resolve AUTH_ADAPTER from. `ws` reads
   * `options.verifyClient` and `options.handleProtocols` inside `handleUpgrade`,
   * on every upgrade, so assigning them after construction takes effect for
   * every connection.
   */
  afterInit(server: {
    options: {
      verifyClient?: unknown;
      handleProtocols?: unknown;
    };
    clients?: Set<CloseableSocket>;
    on?: (event: 'close', listener: () => void) => void;
  }): void {
    server.options.verifyClient = createVerifyClient(
      (token) => this.auth.verifyToken(token),
      this.logger,
    );
    server.options.handleProtocols = handleProtocols;

    // Heartbeat. A socket that missed a pong is ended with `terminate()`: a
    // dead peer never completes a closing handshake, so `close()` would leave
    // it holding its turns for ws's whole close timeout. Its disconnect then
    // frees the turns, the user's turn ceiling and the credit lease.
    const clients = server.clients;
    if (!clients) return;
    const ping = setInterval(() => {
      clients.forEach((socket) => {
        // A socket that cannot report a pong is never judged by one: ending it
        // for silence it had no way to break would cut a healthy connection.
        const answered = this.alive.get(socket);
        if (answered === undefined) return;
        try {
          if (answered === false) {
            socket.terminate?.();
            return;
          }
          this.alive.set(socket, false);
          socket.ping?.();
        } catch (err) {
          // One socket's failure must not skip the rest of the sweep.
          this.logger.warn(
            `heartbeat failed on a socket: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      });
    }, PING_INTERVAL_MS);
    ping.unref?.();
    server.on?.('close', () => clearInterval(ping));
  }

  /**
   * Answer a start from a client built before `languagePair` replaced
   * `direction`: a tab left open across that deploy, or an extension built
   * from an older checkout.
   *
   * Its start is malformed either way, but a malformed start is THROWN and
   * reaches the client as silence — the adapter swallows a throw and the socket
   * simply goes quiet — so the stale page would sit in "connecting" with
   * nothing telling it to reload. Emitted instead, in a shape the old client
   * already parses — `server.error` takes any code string. Any `direction` key
   * is refused, even beside a `languagePair`, matching REST `/translate`: no
   * current client sends one.
   */
  private refuseLegacyStart(client: StreamSocket, payload: unknown): boolean {
    if (typeof payload !== 'object' || payload === null) return false;
    if (!('direction' in payload)) return false;

    this.logger.warn(
      'Refused a turn start sending the removed direction field',
    );
    const message =
      'This page was built for an older server; reload it to keep translating';
    const { turnId } = payload as { turnId?: unknown };
    this.emit(client, {
      type: 'server.error',
      code: 'client_outdated',
      message,
      // Echoed so an ordered playback queue that reserved this turn stops
      // waiting on it — but only an id the client schema would accept.
      turnId:
        typeof turnId === 'string' && turnId.length <= 64 ? turnId : undefined,
    });
    return true;
  }

  /**
   * Run a handler's work in the scope every paid model call it causes is
   * attributed to: this socket's user and the turn named. Work the handler
   * starts and leaves running — a preview, a polish that settles after the turn
   * ended — inherits the scope through its async chain.
   */
  private scoped<T>(
    client: StreamSocket,
    sessionId: string | undefined,
    work: () => T,
  ): T {
    return llmCallScope.run(
      { userId: this.userBySocket.get(client), sessionId },
      work,
    );
  }

  /** Push one contract event, never letting a dead socket take the process down. */
  private emit(client: StreamSocket, event: ServerEvent): void {
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
  ): Promise<void> {
    // Everything except the two fields that are not translation settings is
    // forwarded WHOLESALE, and that is load-bearing rather than tidiness. This
    // used to name each option and rebuild the object, which silently dropped
    // every field added to `sessionOptionsSchema` afterwards: `embedSpeaker` and
    // `repairDisplay` both reached the wire, both parsed here, and neither ever
    // reached `TurnSession` — so speaker embedding and display repair were dead
    // in production while every layer above and below them was correct and
    // tested. Both are optional on the schema, so nothing failed to compile and
    // nothing threw; the features simply never ran.
    //
    // A list that must be edited in a second file every time the contract grows
    // is a list that will be forgotten again. Spreading cannot be.
    //
    // `turnId` is separated because it names the turn rather than configuring
    // the translation, and widening `sessionOptionsSchema` to hold it would drag
    // it through every layer that touches that object. `type` is the discriminant
    // and means nothing past the parse.
    if (this.refuseLegacyStart(client, payload)) return Promise.resolve();
    // `conversationId` is a history label for the turn's credit entry, not a
    // translation setting, so it is kept out of the options like `turnId`.
    const {
      type: _type,
      turnId,
      conversationId,
      resubmit,
      ...options
    } = this.parseEvent(payload, 'client.session.start');
    if (resubmit === true) {
      this.logger.log(
        `turn ${turnId ?? 'unnamed'} resubmitted after a dropped connection`,
      );
    }
    // The upper bound: spoken if ANY language this start may speak is unmuted.
    // A two-way turn's language is known only once heard, so admission cannot
    // know which side it will answer in; the turn reprices down at settle when
    // it lands on a muted one (`TranslationSessionService.settle`).
    const voiceOutput = languagesAStartMaySpeak(options).some(
      (language) => resolveLanguageVoice(options, language).speak,
    );
    // An upper bound for admission: extras count only on a declared one-way
    // turn, which `start()` decides; the turn itself is priced by what it ran.
    const estimate = creditMultiplier({
      voiceOutput,
      extraTargets: options.twoWay
        ? 0
        : (options.alsoTranslateInto?.length ?? 0),
    });
    // Optional fields arrive as they were sent — absent stays absent, since zod
    // omits an optional key rather than setting it undefined. `TurnSession`
    // decides what an omitted one means, so one place knows the default rather
    // than one per layer.
    // Scoped to the user only: `turnId` is the client's name for the turn, not
    // the session id the server mints inside `start()`, so no turn id exists yet
    // to attribute to. Frames and the end carry the real one.
    const admitThenStart = async (): Promise<void> => {
      const userId = this.userBySocket.get(client);
      // The in-memory ceilings first: a start they would refuse must not
      // cost a ledger transaction. `start()` checks them again after the
      // admission awaited the ledger.
      if (this.sessions.refuseOverCapacity(client, options, turnId, userId)) {
        return;
      }
      const admission = await this.meter.admit(client, estimate);
      if (!admission.admitted) {
        this.emit(client, {
          type: 'server.error',
          code: admission.code,
          message: CREDIT_MESSAGES[admission.code],
          turnId,
          // A balance only means something on a credit refusal.
          ...(admission.code === 'too_many_turns'
            ? {}
            : { remainingCreditSeconds: admission.remainingCreditSeconds }),
        });
        return;
      }
      const started = this.scoped(client, undefined, () =>
        this.sessions.start(client, options, turnId, userId),
      );
      if (!started) return;
      this.meter.turnOpened(
        client,
        started.sessionId,
        creditMultiplier({ voiceOutput, extraTargets: started.extraTargets }),
        conversationId,
      );
    };
    // One failure must not poison the chain for every later start.
    const next = (this.startChains.get(client) ?? Promise.resolve())
      .then(admitThenStart)
      .catch((err: unknown) => {
        this.logger.error(
          `turn start failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    this.startChains.set(client, next);
    return next;
  }

  /** The meter ran this socket out of credit: end its listening turns gracefully. */
  private stopForCredits(client: StreamSocket, reason: CreditStopReason): void {
    this.sessions.endAllForCredits(client, reason, (sessionId, work) =>
      this.scoped(client, sessionId, work),
    );
  }

  @SubscribeMessage('client.audio.frame')
  handleAudioFrame(
    @MessageBody() payload: unknown,
    @ConnectedSocket() client: StreamSocket,
  ): void {
    const event = this.parseEvent(payload, 'client.audio.frame');
    const accepted = this.scoped(client, event.frame.sessionId, () =>
      this.sessions.pushFrame(client, event.frame),
    );
    // Only what the turn accepted is billed; a refused frame returns 0.
    this.meter.onFrame(client, event.frame.sessionId, accepted);
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
    this.scoped(client, sessionId, () =>
      this.sessions.speculate(client, sessionId),
    );
  }

  @SubscribeMessage('client.session.end')
  handleSessionEnd(
    @MessageBody() payload: unknown,
    @ConnectedSocket() client: StreamSocket,
  ): Promise<void> {
    const { sessionId } = this.parseEvent(payload, 'client.session.end');
    return this.scoped(client, sessionId, () =>
      this.sessions.end(client, sessionId),
    );
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

  /**
   * How this conversation's previous socket died, reported by the client on
   * the socket that replaced it. Logged only: it is the one view of a drop the
   * server cannot see for itself.
   */
  @SubscribeMessage('client.connection.report')
  handleConnectionReport(
    @MessageBody() payload: unknown,
    @ConnectedSocket() client: StreamSocket,
  ): void {
    const report = this.parseEvent(payload, 'client.connection.report');
    // One per socket: a reconnect sends exactly one, and a client repeating it
    // must not be able to fill the log.
    if (this.reported.has(client)) return;
    this.reported.add(client);
    this.logger.log(
      `connection.report cause=${report.cause} code=${report.closeCode} ` +
        `clean=${report.wasClean} sinceLastFrame=${report.sinceLastServerFrameMs}ms ` +
        `down=${report.downMs}ms inFlight=${report.turnsInFlight} ` +
        `resubmitted=${report.resubmittedTurns} attempt=${report.attempt}`,
    );
  }

  /**
   * Translate a run of this connection's finished segments again as one text.
   * Fire-and-forget: the answer, if any, is `server.block.translated`.
   */
  @SubscribeMessage('client.block.retranslate')
  handleBlockRetranslate(
    @MessageBody() payload: unknown,
    @ConnectedSocket() client: StreamSocket,
  ): void {
    const { segmentIds } = this.parseEvent(payload, 'client.block.retranslate');
    // A block spans several turns; it is attributed to the turn it starts in.
    // A piece's id is `<turn>#<index>`, so the suffix is cut to name the turn.
    const firstTurn = segmentIds[0]?.split('#')[0];
    void this.scoped(client, firstTurn, () =>
      this.sessions.retranslateBlock(
        client,
        segmentIds,
        this.userBySocket.get(client),
      ),
    );
  }

  /**
   * Record which user a freshly upgraded socket belongs to.
   *
   * The subject is read off the upgrade request `ws` hands to this event — the
   * same object `verifyClient` stamped — so the socket and its owner arrive
   * together. A socket with no stamp is not registered: that can only happen if
   * the upgrade bypassed verification, and inventing an owner for it would be
   * worse than declining to close it later.
   */
  handleConnection(client: CloseableSocket, ...args: unknown[]): void {
    const userId = verifiedUserId(args[0]);
    if (userId === undefined) {
      this.logger.warn('a socket connected with no verified subject');
      return;
    }
    const held = this.socketsByUser.get(userId);
    if (held) held.add(client);
    else this.socketsByUser.set(userId, new Set([client]));
    this.userBySocket.set(client, userId);
    if (client.on) {
      this.alive.set(client, true);
      client.on('pong', () => this.alive.set(client, true));
    }
    // Before the lease opens, so a superseded socket's turns, ceiling slots and
    // lease are already free when this socket's first start is admitted.
    this.resumeIfReconnect(client, userId, args[0]);
    this.meter.attach(client, userId, (reason) =>
      this.stopForCredits(client, reason),
    );

    this.closeIfRevokedSinceUpgrade(client, userId, args[0]);
  }

  /**
   * Re-checks the token AFTER the socket is in the registry, and closes it if a
   * reset landed in between.
   *
   * The upgrade check and the registry write are not atomic: `verifyToken`'s
   * read can return, a reset can run — finding nothing to close, because this
   * socket is not registered yet — and only then does the registration land.
   * That socket would then live unbounded, because the guard passes every
   * non-HTTP context and no frame re-authenticates. The window is
   * sub-millisecond, and the thing left behind is a live stream of the victim's
   * audio and transcripts, which is precisely what closing sockets on reset
   * exists to stop.
   *
   * Ordering is what makes this airtight rather than merely narrower: the
   * registration above happens BEFORE this second check. A reset either runs
   * after the registration — and closes the socket itself — or before this
   * check's read, which then sees the new `passwordChangedAt` and closes it
   * here. There is no interleaving left where both miss.
   *
   * Costs one indexed read per upgrade. Sockets are long-lived and rare next to
   * HTTP requests, and this is off the frame path entirely.
   */
  private closeIfRevokedSinceUpgrade(
    client: CloseableSocket,
    userId: string,
    req: unknown,
  ): void {
    const token = tokenFromUpgradeRequest(req);
    if (token === null) return;

    void this.auth.verifyToken(token).catch(() => {
      this.logger.warn('closing a socket revoked during its own upgrade');
      const held = this.socketsByUser.get(userId);
      held?.delete(client);
      if (held?.size === 0) this.socketsByUser.delete(userId);
      try {
        if (client.close) client.close(1008, 'Credentials changed');
        else client.terminate?.();
      } catch {
        // Already gone. Nothing to do, and nothing worth logging twice.
      }
    });
  }

  /**
   * Close every socket this user holds — the transport half of revocation.
   *
   * Closed with 1008 (policy violation) rather than dropped, so a client sees a
   * clean close it can report instead of a connection that simply stops
   * producing audio. Cleanup is left to `handleDisconnect`, which `ws` fires for
   * a server-initiated close exactly as it does for a client-initiated one.
   */
  closeSessionsFor(userId: string): number {
    const held = this.socketsByUser.get(userId);
    if (!held) return 0;

    let closed = 0;
    for (const socket of held) {
      try {
        // `close` performs the closing handshake; `terminate` is the fallback
        // for a socket that does not offer one. Either way the connection ends.
        if (socket.close) socket.close(1008, 'Credentials changed');
        else socket.terminate?.();
        closed += 1;
      } catch (err) {
        this.logger.error(
          `failed to close a socket: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    // Dropped here rather than left to `handleDisconnect`: a socket whose close
    // never produces a disconnect event would otherwise be closed again on the
    // next reset, and the entry would outlive the connection.
    this.socketsByUser.delete(userId);
    return closed;
  }

  /**
   * Join a reconnecting client back to the conversation its previous socket
   * carried, when the upgrade URL names one with `resume`.
   *
   * The previous socket is either still open — it died without a close, the
   * 2026-11-11 case, and is ended here — or already disconnected and parked
   * with only its history left. Either way its conversation history moves to
   * this socket before the history is let go.
   */
  private resumeIfReconnect(
    client: CloseableSocket,
    userId: string,
    req: unknown,
  ): void {
    const key = resumeKeyFrom(req);
    if (key === undefined) return;
    const replaced = this.resumable.claim(userId, key, client);
    if (!replaced) return;
    const { previous, parked } = replaced;

    this.sessions.adoptConversation(previous, client);
    if (parked) {
      this.sessions.forgetConversation(previous);
    } else {
      // Now, not when `ws` reports the end below: that report is a tick away,
      // and this client's first start must not find the old turns still
      // holding the user's ceiling. The lease close it starts is async, which
      // is what `leaseClosing` below waits for.
      this.handleDisconnect(previous);
      try {
        if (previous.terminate) previous.terminate();
        else previous.close?.(4001, 'Superseded by a reconnect');
      } catch (err) {
        this.logger.error(
          `failed to end a superseded socket: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    // This socket's starts queue behind the old lease closing; see `leaseClosing`.
    const closing = this.leaseClosing.get(previous);
    if (closing) this.startChains.set(client, closing);
    this.logger.log(
      `socket.superseded user=${userId.slice(0, 8)} previous=${parked ? 'parked' : 'open'}`,
    );
  }

  /** Free everything a dropped socket was holding. */
  handleDisconnect(client: CloseableSocket): void {
    if (this.disconnected.has(client)) return;
    this.disconnected.add(client);
    try {
      // Settles every turn still open, so the detach below can close the lease.
      // A socket that may yet be resumed keeps its conversation history for
      // the reconnect window; its turns close all the same.
      if (this.resumable.release(client)) {
        this.sessions.disconnect(client, { keepConversation: true });
      } else {
        this.sessions.disconnect(client);
      }
    } finally {
      this.unregisterSocket(client);
      // Never awaited and never unhandled: a ledger outage at disconnect is
      // logged, and the reaper gives the lease back if the close did not land.
      const detached = this.meter
        .detach(client)
        .catch((err: unknown) =>
          this.logger.warn(
            `closing the credit lease failed: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
      this.leaseClosing.set(client, detached);
    }
  }

  /**
   * Drop a closed socket from the revocation registry, and the user's entry with
   * it once their last socket is gone.
   *
   * Scanning every user rather than keeping a socket-to-user index: this runs
   * once per disconnect against a map holding one entry per CONNECTED user, and
   * a second index would be a second thing to keep in step with the first.
   */
  private unregisterSocket(client: CloseableSocket): void {
    for (const [userId, held] of this.socketsByUser) {
      if (!held.delete(client)) continue;
      if (held.size === 0) this.socketsByUser.delete(userId);
      return;
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
}
