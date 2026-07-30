import type { SessionOptions } from '@chatofy/types';
import { pcm16ToBase64, TARGET_SAMPLE_RATE } from '../audio/pcm-resampler.js';
import { newTurnId } from '../transport/translate-socket.js';

/**
 * Which turns are in flight, and everything about a turn that is per turn.
 *
 * `ConversationSession` used to hold four fields for "the" turn, and all four are
 * per turn rather than per conversation:
 *
 *  - `sessionId` routes frames.
 *  - `sequence` must advance WITHIN a turn; the server rejects a frame whose
 *    sequence has not moved, so a shared counter breaks the moment two turns
 *    interleave.
 *  - `pending` is audio captured before `server.session.ready` arrived.
 *  - `ended` is half the condition for considering the turn finished.
 *
 * The one that bites hardest is `sequence`, and the forced cut is what exposes it.
 * `onTurnOpen` reset `sequence` to 0 and `sessionId` to null for the conversation,
 * so the tail of turn N — flushed as the cut lands — went out carrying turn N+1's
 * session id with a sequence restarting at 0. The server then either appended turn
 * N's audio to turn N+1's buffer, corrupting a sentence with no error anywhere, or
 * rejected the frame.
 *
 * Only one turn is ever being CAPTURED, because `CapturePump` runs a single gate.
 * Several are in flight because a turn stays in flight until the server closes it,
 * long after capture has moved on.
 */

/** Where a turn is between being captured and being closed by the server. */
export type TurnPhase =
  /** Locally open, `client.session.start` not sent yet — held by the ceiling. */
  | 'waiting'
  /** Start sent, no `server.session.ready` yet. Audio accumulates in `pending`. */
  | 'handshaking'
  /** Has a session id; audio goes straight out. */
  | 'streaming'
  /** `client.session.end` sent; waiting for the server to close it. */
  | 'ending';

/**
 * Turns this client will have open at the server at once.
 *
 * One is the web page's setting and keeps its behaviour exactly as it was, down to
 * the sequence of events. Continuous capture uses three, matching the server's own
 * per-socket ceiling — going higher only earns `too_many_turns`.
 */
export const DEFAULT_MAX_IN_FLIGHT = 1;

/**
 * Captured audio that may sit un-sent across all waiting turns.
 *
 * Ceiling rather than none: a server that never answers a handshake left `pending`
 * growing without limit, which on a long meeting is a tab that runs out of memory
 * rather than a conversation that reports a problem.
 */
const MAX_PENDING_MS = 20_000;

export interface TurnPipelineTransport {
  startSession(options: SessionOptions, turnId: string): void;
  sendAudio(sessionId: string, sequence: number, sampleRate: number, payload: string): void;
  speculate(sessionId: string | null): void;
  endSession(sessionId: string | null): void;
}

export interface TurnPipelineHandlers {
  /** A turn now exists and has claimed its place in speaking order. */
  onTurnOpened?: (turnId: string) => void;
  /** The server named the turn. Frames for it can be routed from here on. */
  onTurnReady?: (turnId: string, sessionId: string) => void;
  /**
   * The turn is finished as far as this client is concerned, whichever way.
   *
   * Fires exactly once per turn, on every path: a normal close, a turn-level
   * error, a refusal that never had a session id, and an abandonment at the
   * pending ceiling. Anything downstream that waits on a turn — the ordering
   * layer above all — jams forever if a path is missed.
   */
  onTurnClosed?: (turnId: string, reason: string) => void;
  /** Diagnostics that must never be silent. */
  onLog?: (message: string) => void;
}

interface Turn {
  readonly turnId: string;
  phase: TurnPhase;
  sessionId: string | null;
  /** Advances within THIS turn. The server rejects a sequence that does not move. */
  sequence: number;
  /** Captured before the handshake landed, oldest first. */
  pending: Int16Array[];
  pendingMs: number;
  /**
   * Capture has finished with this turn, whether or not it reached the server yet.
   *
   * A turn held back by the in-flight ceiling still gets captured in full — the
   * microphone does not wait for a slot. Its audio is a complete utterance that is
   * merely late, so it is kept and sent when a slot frees rather than discarded,
   * and this is the flag that says to close it the moment it has an id.
   */
  captureFinished: boolean;
}

export class TurnPipeline {
  private readonly turns = new Map<string, Turn>();
  /** The turn capture is currently feeding. Only ever one — one gate, one turn. */
  private capturing: string | null = null;
  private options: SessionOptions | null = null;

  constructor(
    private readonly transport: TurnPipelineTransport,
    private readonly handlers: TurnPipelineHandlers = {},
    private readonly maxInFlight: number = DEFAULT_MAX_IN_FLIGHT,
  ) {}

  /** Settings every turn of this conversation is opened with. */
  configure(options: SessionOptions): void {
    this.options = options;
  }

  get inFlight(): number {
    return this.turns.size;
  }

  /** Turn ids that exist right now, oldest first. */
  get openTurnIds(): string[] {
    return [...this.turns.keys()];
  }

  phaseOf(turnId: string): TurnPhase | undefined {
    return this.turns.get(turnId)?.phase;
  }

  /**
   * The client's name for the turn the server calls `sessionId`.
   *
   * Audio frames carry only the server's id, while speaking order is keyed by the
   * client's — it has to be, because order is fixed when capture opens the turn and
   * the server id does not exist yet. This is the join between the two.
   */
  turnIdFor(sessionId: string): string | undefined {
    for (const turn of this.turns.values()) {
      if (turn.sessionId === sessionId) return turn.turnId;
    }
    return undefined;
  }

  /** The server's id for a turn, once it has one. */
  sessionIdFor(turnId: string): string | null {
    return this.turns.get(turnId)?.sessionId ?? null;
  }

  /**
   * Capture has opened a turn. Claim its identity and its place in order.
   *
   * The turn exists locally whether or not the start can be sent: order has to be
   * fixed by when someone began speaking, not by when a slot happened to free.
   */
  openTurn(preRoll: Int16Array[]): string {
    const turnId = newTurnId();
    const turn: Turn = {
      turnId,
      phase: 'waiting',
      sessionId: null,
      sequence: 0,
      pending: [],
      pendingMs: 0,
      captureFinished: false,
    };
    this.turns.set(turnId, turn);
    this.capturing = turnId;
    for (const block of preRoll) this.hold(turn, block);

    this.handlers.onTurnOpened?.(turnId);
    this.tryStart(turn);
    return turnId;
  }

  /** One block of captured audio, for whichever turn is being captured. */
  pushAudio(block: Int16Array): void {
    const turn = this.capturing ? this.turns.get(this.capturing) : undefined;
    if (!turn) return;

    if (turn.phase === 'streaming' && turn.sessionId) {
      this.transport.sendAudio(
        turn.sessionId,
        turn.sequence++,
        TARGET_SAMPLE_RATE,
        pcm16ToBase64(block),
      );
      return;
    }
    // Still waiting on a slot or on the handshake. Held rather than dropped.
    this.hold(turn, block);
    this.enforcePendingCeiling();
  }

  /** The speaker may have stopped: let the server start early on this turn. */
  speculate(): void {
    const turn = this.capturing ? this.turns.get(this.capturing) : undefined;
    if (!turn || turn.phase === 'waiting') return;
    this.transport.speculate(turn.sessionId);
  }

  /**
   * Capture has finished with its turn. Ask the server to close it.
   *
   * `capturing` is cleared here rather than in `openTurn`, so a block arriving
   * between two turns is not attributed to the next one.
   */
  closeCapturedTurn(): void {
    const turn = this.capturing ? this.turns.get(this.capturing) : undefined;
    this.capturing = null;
    if (!turn) return;

    turn.captureFinished = true;

    if (turn.phase === 'waiting') {
      // Held back by the ceiling and now fully captured. Kept, not discarded: its
      // audio is a complete utterance that is merely late, and throwing it away
      // here would lose a whole sentence for no reason other than that the client
      // was busy when the speaker finished. It starts when a slot frees, and the
      // pending ceiling is what bounds how long that can go on.
      return;
    }
    turn.phase = 'ending';
    // Only once the turn has a name. Sending `client.session.end` without one
    // makes the server fall back to "the socket's only turn", which is the wrong
    // turn as soon as more than one is open — it would close a turn someone is
    // still speaking into. `onReady` sends it the moment the id lands.
    if (turn.sessionId) this.transport.endSession(turn.sessionId);
  }

  /** `server.session.ready`: the turn has a server id and may stream. */
  onReady(turnId: string | undefined, sessionId: string): void {
    // Matched by the client's own name when it came back, and otherwise by the
    // only turn that could be waiting for an answer. The fallback exists because
    // `turnId` is optional on the wire.
    const turn = turnId ? this.turns.get(turnId) : this.onlyAwaitingId();
    if (!turn) return;

    turn.sessionId = sessionId;
    if (turn.phase === 'handshaking') turn.phase = 'streaming';
    this.handlers.onTurnReady?.(turn.turnId, sessionId);
    this.flushPending(turn);

    // A turn capture had already finished with was waiting only for this id.
    if (turn.captureFinished) {
      turn.phase = 'ending';
      this.transport.endSession(sessionId);
    }
  }

  /** The server closed a turn. Identified by either name. */
  onServerClosed(reason: string, ids: { sessionId?: string; turnId?: string }): void {
    const turn = this.find(ids);
    if (!turn) return;
    this.forget(turn, reason);
  }

  /**
   * A server error. Returns true when it ended a turn, so the caller knows
   * whether the conversation itself is in trouble.
   *
   * `too_many_turns` is the case worth spelling out: the refusal happens inside the
   * server's `start()`, before any session id exists, so the turn is identifiable
   * only by the name this client gave it. Its audio is kept and the start retried
   * once a slot frees.
   */
  onError(code: string, ids: { sessionId?: string; turnId?: string }): boolean {
    const turn = this.find(ids);
    if (!turn) return false;

    if (code === 'too_many_turns') {
      // Back to waiting, audio intact. The retry happens when another turn closes.
      turn.phase = 'waiting';
      this.handlers.onLog?.(
        `turn ${turn.turnId} refused (too_many_turns); holding ${Math.round(turn.pendingMs)}ms of audio`,
      );
      return true;
    }

    this.forget(turn, code);
    return true;
  }

  /** Give up every turn — the conversation is being torn down. */
  reset(): void {
    for (const turn of [...this.turns.values()]) this.forget(turn, 'stopped');
    this.turns.clear();
    this.capturing = null;
  }

  private hold(turn: Turn, block: Int16Array): void {
    turn.pending.push(block);
    turn.pendingMs += (block.length / TARGET_SAMPLE_RATE) * 1000;
  }

  /**
   * Send everything held during the handshake.
   *
   * Detached before the loop, not during it. `pushAudio` pushes back onto
   * `pending` whenever the id is missing, so iterating the live array would hand
   * the same blocks to the next flush with an advancing sequence — and an
   * advancing sequence is exactly what the server's replay guard lets through. The
   * utterance would double with nothing reporting it.
   */
  private flushPending(turn: Turn): void {
    if (!turn.sessionId) return;
    const held = turn.pending;
    turn.pending = [];
    turn.pendingMs = 0;
    for (const block of held) {
      this.transport.sendAudio(
        turn.sessionId,
        turn.sequence++,
        TARGET_SAMPLE_RATE,
        pcm16ToBase64(block),
      );
    }
  }

  /** Send the start if a slot is free; otherwise leave the turn waiting. */
  private tryStart(turn: Turn): void {
    if (turn.phase !== 'waiting' || !this.options) return;
    // Counts turns that have actually reached the server. Waiting turns hold no
    // server resources, so they must not count against the ceiling that protects
    // them.
    const atServer = [...this.turns.values()].filter((t) => t.phase !== 'waiting').length;
    if (atServer >= this.maxInFlight) return;

    turn.phase = 'handshaking';
    this.transport.startSession(this.options, turn.turnId);
  }

  /** A slot may have freed: start the oldest turn still waiting for one. */
  private startNextWaiting(): void {
    for (const turn of this.turns.values()) {
      if (turn.phase === 'waiting') {
        this.tryStart(turn);
        if (turn.phase !== 'waiting') return;
      }
    }
  }

  private forget(turn: Turn, reason: string): void {
    this.turns.delete(turn.turnId);
    if (this.capturing === turn.turnId) this.capturing = null;
    this.handlers.onTurnClosed?.(turn.turnId, reason);
    this.startNextWaiting();
  }

  /**
   * Abandon the oldest waiting turn while held audio is over its ceiling.
   *
   * The same policy the playback backlog uses, for the same stated reason: staying
   * close to real time beats completeness, because what was said several seconds
   * ago has already lost its value. The turn being captured right now is never
   * abandoned — dropping it would throw away the words being spoken as they are
   * spoken.
   */
  private enforcePendingCeiling(): void {
    for (;;) {
      let total = 0;
      for (const turn of this.turns.values()) total += turn.pendingMs;
      if (total <= MAX_PENDING_MS) return;

      const oldest = [...this.turns.values()].find(
        (turn) => turn.pendingMs > 0 && turn.turnId !== this.capturing,
      );
      if (!oldest) return;

      this.handlers.onLog?.(
        `dropped turn ${oldest.turnId} (pending ceiling): ` +
          `${Math.round(oldest.pendingMs)}ms of captured audio discarded`,
      );
      this.forget(oldest, 'dropped_pending');
    }
  }

  /**
   * The one turn that could be waiting for a server id, if there is exactly one.
   *
   * "Awaiting an id" is not the same as "handshaking": capture may have already
   * finished with a turn whose `ready` has not arrived, leaving it in `ending`
   * with a null id. Both phases are candidates, and when two turns qualify this
   * refuses rather than guessing — a wrong match routes one turn's audio into
   * another and corrupts it with nothing reporting the fault.
   */
  private onlyAwaitingId(): Turn | undefined {
    const awaiting = [...this.turns.values()].filter(
      (turn) => turn.sessionId === null && turn.phase !== 'waiting',
    );
    return awaiting.length === 1 ? awaiting[0] : undefined;
  }

  private find(ids: { sessionId?: string; turnId?: string }): Turn | undefined {
    if (ids.turnId) {
      const byTurn = this.turns.get(ids.turnId);
      if (byTurn) return byTurn;
    }
    if (ids.sessionId) {
      for (const turn of this.turns.values()) {
        if (turn.sessionId === ids.sessionId) return turn;
      }
    }
    return undefined;
  }
}
