import type { Logger } from '@nestjs/common';
import type { ServerEvent } from '@chatofy/types';
import type { StreamSocket } from './stream-socket';

/**
 * The names a turn goes by, as far as they are known.
 *
 * `sessionId` is the server's, assigned when the turn opens. `turnId` is the
 * client's, carried on `client.session.start`.
 *
 * Both are optional because a refusal to open a turn at all — the concurrency
 * ceiling, or a turn already translating — happens before any `sessionId`
 * exists, and the client's name is then the only one there is. `ended()` is the
 * one member that insists on `sessionId`, because a turn cannot have finished
 * without having started.
 *
 * `TurnSession` satisfies this structurally, so a caller normally passes the
 * session itself rather than building a literal.
 */
export interface TurnRef {
  readonly sessionId?: string;
  readonly turnId?: string;
}

/**
 * Everything this path sends to one client, and the only place a send failure
 * is handled.
 *
 * A channel is bound to at most one turn. It used to hold no turn state at all,
 * on the reasoning that fire-and-forget work keeps a channel across an await and
 * the turn may be gone by the time the answer lands. That reasoning survives —
 * the channel still never asks whether its turn is current, and
 * `SessionRegistry.holds` is still what answers that — but it no longer implies
 * the channel should be nameless. With several turns open on one socket, an event
 * that does not say which turn it belongs to cannot be routed at all, and
 * `ended()` in particular has to name a turn it has no other way to know.
 *
 * So the binding is passed in at construction and never inferred. The old
 * property that mattered is kept: this class does not invent ids.
 *
 * The logger is the owning service's rather than a fresh one, so the context on
 * every line stays where operators are already looking for it.
 */
export class EventChannel {
  constructor(
    private readonly socket: StreamSocket,
    private readonly logger: Logger,
    /**
     * The turn every event from this channel belongs to, or null for the
     * connection itself — a malformed frame or a message arriving with no turn
     * open belongs to no turn, and saying otherwise would be a guess.
     */
    private readonly turn: TurnRef | null = null,
  ) {}

  emit(event: ServerEvent): void {
    try {
      this.socket.send(JSON.stringify(event));
    } catch (err) {
      // A socket that closed underneath us surfaces here. `ws` reports a send
      // after close as an error event when no callback is given, and an
      // unhandled one would take the process down for a client that already
      // left, so this is swallowed rather than propagated into the turn.
      this.logger.warn(
        `dropped ${event.type}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  fail(code: string, message: string): void {
    this.emit({
      type: 'server.error',
      code,
      message,
      sessionId: this.turn?.sessionId,
      turnId: this.turn?.turnId,
    });
  }

  /**
   * Announce that the turn is over.
   *
   * Only announces it. Dropping the turn from the registry is the service's
   * job, and has to happen first — a turn that is "ended" on the wire while the
   * server still holds it keeps its buffer alive and stays reachable.
   */
  ended(reason: string): void {
    const sessionId = this.turn?.sessionId;
    if (!sessionId) {
      // The contract has no shape for the end of no particular turn, and a
      // client could not act on one. Reaching here means a caller built an
      // unbound channel for turn-scoped work, which is a wiring mistake.
      this.logger.warn(
        `dropped server.session.ended (${reason}): channel names no open turn`,
      );
      return;
    }
    this.emit({
      type: 'server.session.ended',
      reason,
      sessionId,
      turnId: this.turn?.turnId,
    });
  }
}
