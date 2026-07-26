import type { StreamSocket } from './stream-socket';
import type { TurnSession } from './turn-session';

/**
 * Which socket is currently taking which turn.
 *
 * Keyed by the socket object itself, so a connection that goes away takes its
 * entry with it the moment the gateway reports the close — there is no id to
 * look up and no way for two connections to collide.
 *
 * {@link holds} is the question every piece of fire-and-forget work has to ask
 * before it writes: not "does this socket have a turn" but "is this still the
 * turn I started on". A socket that reconnected and opened a new one must not
 * receive the old one's answers.
 */
export class SessionRegistry {
  private readonly sessions = new Map<StreamSocket, TurnSession>();

  get(socket: StreamSocket): TurnSession | undefined {
    return this.sessions.get(socket);
  }

  open(socket: StreamSocket, session: TurnSession): void {
    this.sessions.set(socket, session);
  }

  /** Drop the socket's turn, returning it if there was one. */
  close(socket: StreamSocket): TurnSession | undefined {
    const session = this.sessions.get(socket);
    this.sessions.delete(socket);
    return session;
  }

  holds(socket: StreamSocket, session: TurnSession): boolean {
    return this.sessions.get(socket) === session;
  }
}
