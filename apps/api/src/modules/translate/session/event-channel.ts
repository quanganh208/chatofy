import type { Logger } from '@nestjs/common';
import type { ServerEvent } from '@chatofy/types';
import type { StreamSocket } from './stream-socket';

/**
 * Everything this path sends to one client, and the only place a send failure
 * is handled.
 *
 * Holds no turn state, which is what lets fire-and-forget work keep a channel
 * across an await: the turn it belongs to may be long gone by the time the
 * answer lands, and the channel neither knows nor needs to.
 *
 * The logger is the owning service's rather than a fresh one, so the context on
 * every line stays where operators are already looking for it.
 */
export class EventChannel {
  constructor(
    private readonly socket: StreamSocket,
    private readonly logger: Logger,
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
    this.emit({ type: 'server.error', code, message });
  }

  /**
   * Announce that the turn is over.
   *
   * Only announces it. Dropping the turn from the registry is the service's
   * job, and has to happen first — a turn that is "ended" on the wire while the
   * server still holds it keeps its buffer alive and stays reachable.
   */
  ended(reason: string): void {
    this.emit({ type: 'server.session.ended', reason });
  }
}
