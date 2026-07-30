import type { StreamSocket } from './stream-socket';
import type { TurnSession } from './turn-session';

/**
 * Which socket is currently taking which turns.
 *
 * Keyed by the socket object itself, so a connection that goes away takes its
 * entries with it the moment the gateway reports the close — there is no id to
 * look up and no way for two connections to collide. Turns within a socket are
 * keyed by the server-assigned `sessionId`.
 *
 * A socket used to map to exactly one turn. It now maps to several, and the
 * nested map is not an implementation detail: it is what makes {@link holds}
 * answerable. That method is the question every piece of fire-and-forget work has
 * to ask before it writes, and the question is "is this still the turn I started
 * on", never "does this socket have a turn". With one turn those two readings
 * were indistinguishable; with several, the loose one writes a finished turn's
 * answer into whichever turn happens to be open, and reports nothing.
 *
 * A socket's entry is deleted once its last turn closes. Leaving an empty map
 * behind would leak one entry per connection for the life of the process, and
 * this endpoint takes no authentication.
 */
/**
 * Recently closed turns remembered per socket, so a client's measurements for a
 * turn can still be attributed after it ends.
 *
 * Metrics for a turn necessarily arrive after the turn is over — they include when
 * its audio finished playing. Bounded, and small: the point is to accept a
 * straggler, not to keep a history. An unbounded list would be a per-connection
 * memory leak on an endpoint that takes no authentication.
 */
const REMEMBERED_CLOSED_TURNS = 8;

export class SessionRegistry {
  private readonly sessions = new Map<StreamSocket, Map<string, TurnSession>>();
  private readonly recentlyClosed = new Map<StreamSocket, string[]>();

  get(socket: StreamSocket, sessionId: string): TurnSession | undefined {
    return this.sessions.get(socket)?.get(sessionId);
  }

  /**
   * The socket's turn, when it has exactly one.
   *
   * The fallback for a client that sends no session id, which the contract
   * permits so a tab loaded before that field existed keeps working. Undefined
   * when the socket holds several turns: picking one would route audio into the
   * wrong utterance and corrupt it silently, and any client that opens concurrent
   * turns sends the id.
   */
  only(socket: StreamSocket): TurnSession | undefined {
    const turns = this.sessions.get(socket);
    if (!turns || turns.size !== 1) return undefined;
    return turns.values().next().value;
  }

  open(socket: StreamSocket, session: TurnSession): void {
    let turns = this.sessions.get(socket);
    if (!turns) {
      turns = new Map();
      this.sessions.set(socket, turns);
    }
    turns.set(session.sessionId, session);
  }

  /** Drop one turn of a socket, returning it if there was one. */
  close(socket: StreamSocket, sessionId: string): TurnSession | undefined {
    const turns = this.sessions.get(socket);
    if (!turns) return undefined;
    const session = turns.get(sessionId);
    turns.delete(sessionId);
    if (session) this.remember(socket, sessionId);
    if (turns.size === 0) this.sessions.delete(socket);
    return session;
  }

  /** Drop every turn of a socket, returning them — for a connection that closed. */
  closeAll(socket: StreamSocket): TurnSession[] {
    const turns = this.sessions.get(socket);
    // The socket itself is gone, so nothing can arrive for it again and there is
    // nothing to remember. Dropping the record here is what keeps this bounded
    // across the lifetime of the process.
    this.recentlyClosed.delete(socket);
    if (!turns) return [];
    this.sessions.delete(socket);
    return [...turns.values()];
  }

  /**
   * Whether this socket has any claim to a session id: open now, or just closed.
   *
   * The question a client-supplied id has to answer before anything is written on
   * its behalf. Turn ids are not capabilities — `/ws/translate` takes no
   * authentication, so without this check one client could file measurements
   * against another client's turn simply by naming it.
   *
   * "Just closed" is included because measurements for a turn necessarily arrive
   * after it ends: they say when its audio finished playing.
   */
  owns(socket: StreamSocket, sessionId: string): boolean {
    if (this.sessions.get(socket)?.has(sessionId)) return true;
    return this.recentlyClosed.get(socket)?.includes(sessionId) ?? false;
  }

  private remember(socket: StreamSocket, sessionId: string): void {
    const closed = this.recentlyClosed.get(socket) ?? [];
    closed.push(sessionId);
    while (closed.length > REMEMBERED_CLOSED_TURNS) closed.shift();
    this.recentlyClosed.set(socket, closed);
  }

  holds(socket: StreamSocket, session: TurnSession): boolean {
    return this.sessions.get(socket)?.get(session.sessionId) === session;
  }

  /** Turns this socket has open. Guards fairness between clients. */
  count(socket: StreamSocket): number {
    return this.sessions.get(socket)?.size ?? 0;
  }

  /**
   * Turns open across the whole process.
   *
   * This is the number that guards the machine. The STT and TTS sidecars are one
   * shared process each, so a ceiling divided per socket cannot see the load at
   * all: two sockets at three turns apiece is six concurrent inferences with no
   * per-socket ceiling touched, and nothing limits how many sockets there are.
   */
  countGlobal(): number {
    let total = 0;
    for (const turns of this.sessions.values()) total += turns.size;
    return total;
  }

  /** Sockets with at least one open turn. Exists to prove entries are released. */
  get trackedSockets(): number {
    return this.sessions.size;
  }
}
