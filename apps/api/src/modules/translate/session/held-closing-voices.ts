import type { StreamSocket } from './stream-socket';
import type { TurnSession } from './turn-session';

/**
 * How long a closing piece's label waits for the next turn's voice.
 *
 * The next turn has to close, be transcribed and be embedded first: up to the
 * 8 s ceiling plus a second or two. Past this the piece goes out with the rest
 * of its own turn's voice, which is what it always had.
 */
export const HOLD_CLOSING_MS = 12_000;

/** A short closing piece whose vector is held until the next turn speaks. */
export interface HeldClosing {
  /** The piece's own vector: too short to cluster, enough to compare. */
  own: readonly number[];
  /** The rest of its turn's voice, compared against the next turn's. */
  rest: readonly number[];
  /** What it is sent with when no next voice decides it. */
  fallback: readonly number[];
  /** Sends the piece's vector once it is decided. */
  send: (vector: readonly number[]) => void;
}

interface Waiting {
  closing: HeldClosing;
  next: TurnSession;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Short closing pieces waiting for the voice of the turn after them.
 *
 * "…training our brains. | Perfect." — the next speaker's first word, caught at
 * the end of this turn after a pause. The piece is too short for a vector a
 * clusterer can trust, but comparing it against two voices put a short piece on
 * the right speaker 31 times in 36 (Scribe-diarized recordings). One of those
 * voices does not exist yet when the turn is split, so the label waits for it;
 * the piece's words and translation never do.
 *
 * Held only while a later turn is already open on the connection. A closing
 * with nothing open after it — the user stopped, or went quiet — is sent at
 * once with its fallback, what it was sent with before, so stopping never
 * leaves a piece unlabelled.
 */
export class HeldClosingVoices {
  private readonly waiting = new WeakMap<StreamSocket, Waiting>();
  /** Each turn's first voice of its own, for a closing that is decided late. */
  private readonly firstVoices = new WeakMap<TurnSession, readonly number[]>();

  constructor(private readonly holdMs = HOLD_CLOSING_MS) {}

  /**
   * Hold `closing` for `next`'s voice, or decide it now when that voice is
   * already known or there is no `next` to wait for.
   */
  hold(
    socket: StreamSocket,
    closing: HeldClosing,
    next: TurnSession | undefined,
  ): void {
    this.release(socket);
    if (!next) {
      closing.send(closing.fallback);
      return;
    }
    const known = this.firstVoices.get(next);
    if (known) {
      closing.send(closerVoice(closing, known));
      return;
    }
    const timer = setTimeout(() => this.release(socket), this.holdMs);
    timer.unref?.();
    this.waiting.set(socket, { closing, next, timer });
  }

  /**
   * A turn's first voice of its own — never one it was handed for a piece. It
   * decides the closing waiting on that turn, if there is one.
   */
  heard(
    socket: StreamSocket,
    session: TurnSession,
    voice: readonly number[],
  ): void {
    if (this.firstVoices.has(session)) return;
    this.firstVoices.set(session, voice);
    const waiting = this.waiting.get(socket);
    if (!waiting || waiting.next !== session) return;
    clearTimeout(waiting.timer);
    this.waiting.delete(socket);
    waiting.closing.send(closerVoice(waiting.closing, voice));
  }

  /** Send what is waiting with its fallback. */
  release(socket: StreamSocket): void {
    const waiting = this.waiting.get(socket);
    if (!waiting) return;
    clearTimeout(waiting.timer);
    this.waiting.delete(socket);
    waiting.closing.send(waiting.closing.fallback);
  }

  /** Forget what is waiting: the connection is gone and nothing can be sent. */
  drop(socket: StreamSocket): void {
    const waiting = this.waiting.get(socket);
    if (!waiting) return;
    clearTimeout(waiting.timer);
    this.waiting.delete(socket);
  }
}

/** The next turn's voice when the piece is closer to it, else its own turn's. */
export function closerVoice(
  closing: Pick<HeldClosing, 'own' | 'rest'>,
  next: readonly number[],
): readonly number[] {
  return cosine(closing.own, next) > cosine(closing.own, closing.rest)
    ? next
    : closing.rest;
}

function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}
