import { CONTEXT_LIMITS } from '@chatofy/types';
import type { StreamSocket } from './stream-socket';

/**
 * What the speaker on this connection has finished saying lately.
 *
 * A speaker who hesitates mid-sentence produces two- and three-word turns, and
 * each one used to reach the translator alone: "Thì nó" arrived as two words
 * plus the session's glossary, with nothing to say what sentence it was inside.
 * This is that sentence, and it is the only per-connection state on this path
 * that outlives a turn.
 *
 * It is NOT in {@link SessionRegistry}. That class answers one question — is
 * this still the turn I started on — and every piece of fire-and-forget work on
 * this path depends on it answering only that. Transcript history has a
 * different lifetime (it survives every turn of a connection, where a turn entry
 * is deleted the moment the turn closes) and a different failure mode, so it
 * gets its own holder rather than a second meaning for `sessions`.
 *
 * Keyed by the socket object in a `WeakMap`, for the reason the registry keys
 * its own recent-turn record that way: `/ws/translate` takes no authentication,
 * so a connection's memory must be released structurally and not because a
 * disconnect handler was reached.
 */

/**
 * How many finished utterances are kept per connection.
 *
 * FOUR, which is what {@link TranslationRequest.context} is bounded to on the
 * prompt side. Keeping more would be memory held on an unauthenticated endpoint
 * that no reader could ever spend, and keeping fewer would silently starve a cap
 * the prompt builder enforces anyway.
 *
 * The two caps agree deliberately and are still enforced twice: this one is what
 * a connection will remember, the builder's is what a prompt will carry, and
 * neither trusts the other — the same split the glossary's word cap keeps
 * between the socket schema and the prompt.
 */
const REMEMBERED_UTTERANCES = 4;

/** One finished utterance, and the turn that said it when one is named. */
interface Utterance {
  sessionId?: string;
  text: string;
}

/** A turn somebody is waiting on, and who. */
type Waiters = Map<string, Array<(text: string | undefined) => void>>;

export class ConversationContext {
  private readonly recent = new WeakMap<StreamSocket, Utterance[]>();
  /**
   * The last turn OPENED on each connection, for naming a continuation's
   * predecessor. A client opens turns in the order it captured them — the
   * pipeline starts the oldest waiting turn first — so the turn opened just
   * before a continuation is the one the ceiling cut.
   */
  private readonly lastOpened = new WeakMap<StreamSocket, string>();
  private readonly waiters = new WeakMap<StreamSocket, Waiters>();
  /** Turns that closed without a transcript, so a late waiter is answered at once. */
  private readonly silent = new WeakMap<StreamSocket, Set<string>>();
  /**
   * Spellings accepted for garbled foreign spans on this connection, keyed by
   * the span as heard (see `loanword-respelling.ts`), in the order learned.
   *
   * Per connection because a connection is one conversation, and what a speaker
   * keeps saying is that conversation's own vocabulary — the case §3.17 of the
   * development journey measured as a gain, where a standing list was a loss.
   */
  private readonly learned = new WeakMap<StreamSocket, Map<string, string>>();

  /**
   * The finished utterances a turn starting now should be translated against.
   *
   * A fresh array every call: the caller hands it to the pipeline, which hands
   * it to a provider, and handing out the live ring would let a turn that
   * finishes mid-flight change what an in-flight prompt was built from.
   */
  recall(socket: StreamSocket): string[] {
    return (this.recent.get(socket) ?? []).map((utterance) => utterance.text);
  }

  /**
   * Note that a turn opened, and return the turn opened before it.
   *
   * Called for every accepted turn, continuation or not, so the answer is
   * always the immediate predecessor and never an older one.
   */
  opened(socket: StreamSocket, sessionId: string): string | undefined {
    const previous = this.lastOpened.get(socket);
    this.lastOpened.set(socket, sessionId);
    return previous;
  }

  /**
   * Record a turn's source text, once that turn has actually produced one.
   *
   * Called at the point the transcript is final, not when the turn opened, which
   * is what makes the list "finished" rather than "preceding". Order is
   * COMPLETION order: turns run concurrently and one can overtake another, and
   * the alternative — holding a slot for a turn still in flight — would mean a
   * fragment waiting on the very turn whose slowness left it without context.
   * The one exception is {@link textOf}, which waits on purpose, and only for
   * the single turn a continuation is the rest of.
   *
   * An empty or blank text is not recorded. A turn the recognizer returned
   * nothing for has no sentence to contribute, and a blank line of "earlier
   * speech" tells the model something was said and declines to say what.
   *
   * A turn split into several pieces calls this once per piece under its own
   * id, so {@link textOf} answers with the LAST piece — the one that reaches
   * the cut. That holds for a waiter too: the answer goes out one microtask
   * later, after the caller's synchronous loop over the pieces has finished,
   * and carries the latest text recorded under the id. Answering on the first
   * call would hand a continuation the OTHER speaker's piece as the sentence
   * it completes.
   */
  remember(socket: StreamSocket, sourceText: string, sessionId?: string): void {
    const text = sourceText.trim();
    if (!text) return;
    const kept = this.recent.get(socket) ?? [];
    kept.push(sessionId === undefined ? { text } : { sessionId, text });
    while (kept.length > REMEMBERED_UTTERANCES) kept.shift();
    this.recent.set(socket, kept);
    if (sessionId === undefined) return;
    queueMicrotask(() =>
      this.answer(socket, sessionId, this.textNow(socket, sessionId) ?? text),
    );
  }

  /**
   * A turn closed. If it never produced a transcript, whoever waits on it is
   * told now rather than at their deadline.
   */
  closed(socket: StreamSocket, sessionId: string): void {
    if (this.textNow(socket, sessionId) !== undefined) return;
    const silent = this.silent.get(socket) ?? new Set<string>();
    silent.add(sessionId);
    // Bounded like the ring: only the most recent turns can still be waited on.
    if (silent.size > REMEMBERED_UTTERANCES) {
      silent.delete(silent.values().next().value as string);
    }
    this.silent.set(socket, silent);
    this.answer(socket, sessionId, undefined);
  }

  /**
   * The transcript of one named turn, waiting up to `waitMs` for it to finish.
   *
   * `undefined` when the turn produced nothing, has aged out of the ring, or is
   * still unfinished at the deadline. A continuation asks this instead of
   * reading "the latest utterance": with several turns in flight the latest one
   * to FINISH is often not the one that was cut, and the wrong sentence as
   * context is worse than none.
   */
  textOf(
    socket: StreamSocket,
    sessionId: string,
    waitMs: number,
  ): Promise<string | undefined> {
    const settled = this.settledText(socket, sessionId);
    if (settled !== null) return Promise.resolve(settled.text);
    return new Promise((resolve) => {
      const waiters = this.waiters.get(socket) ?? new Map();
      this.waiters.set(socket, waiters);
      const list = waiters.get(sessionId) ?? [];
      waiters.set(sessionId, list);
      const timer = setTimeout(() => settle(undefined), waitMs);
      const settle = (text: string | undefined) => {
        clearTimeout(timer);
        const index = list.indexOf(settle);
        if (index >= 0) list.splice(index, 1);
        if (list.length === 0) waiters.delete(sessionId);
        resolve(text);
      };
      list.push(settle);
    });
  }

  /**
   * The named turn's outcome if it is already known — its text, or `undefined`
   * for a turn that closed silent — and `null` while it is still in flight.
   *
   * Lets a caller with nothing to wait for stay synchronous.
   */
  settledText(
    socket: StreamSocket,
    sessionId: string,
  ): { text: string | undefined } | null {
    const text = this.textNow(socket, sessionId);
    if (text !== undefined) return { text };
    return this.silent.get(socket)?.has(sessionId) ? { text: undefined } : null;
  }

  /**
   * Remember spellings a turn's guards accepted, for the turns after it.
   *
   * Only guarded spellings reach here, never a model's raw proposal: every one
   * becomes a hotword the recognizer is pulled towards for the rest of the
   * conversation, and a wrong one would pull every later turn.
   */
  learnSpellings(
    socket: StreamSocket,
    spellings: Readonly<Record<string, string>>,
  ): void {
    const entries = Object.entries(spellings);
    if (entries.length === 0) return;
    const learned = this.learned.get(socket) ?? new Map<string, string>();
    for (const [span, spelling] of entries) {
      // Re-learned moves to the newest end, so the ceiling below evicts what
      // the conversation stopped saying rather than what it keeps saying.
      learned.delete(span);
      learned.set(span, spelling);
    }
    // No more than the recognizer could ever be sent. Oldest first out, so a
    // long conversation keeps biasing towards its recent vocabulary instead of
    // freezing on whatever filled the list first.
    while (learned.size > CONTEXT_LIMITS.MAX_HOTWORDS) {
      const oldest = learned.keys().next().value;
      if (oldest === undefined) break;
      learned.delete(oldest);
    }
    this.learned.set(socket, learned);
  }

  /** The learned spellings as hotword terms, deduplicated, newest last. */
  learnedTerms(socket: StreamSocket): string[] {
    const terms: string[] = [];
    const seen = new Set<string>();
    for (const spelling of this.learned.get(socket)?.values() ?? []) {
      const key = spelling.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      terms.push(spelling);
    }
    return terms;
  }

  /** Drop a connection's history, for a socket that went away. */
  forget(socket: StreamSocket): void {
    this.recent.delete(socket);
    this.learned.delete(socket);
    this.lastOpened.delete(socket);
    this.silent.delete(socket);
    const waiters = this.waiters.get(socket);
    this.waiters.delete(socket);
    for (const list of waiters?.values() ?? []) {
      for (const settle of [...list]) settle(undefined);
    }
  }

  private textNow(socket: StreamSocket, sessionId: string): string | undefined {
    const kept = this.recent.get(socket) ?? [];
    for (let i = kept.length - 1; i >= 0; i -= 1) {
      if (kept[i]!.sessionId === sessionId) return kept[i]!.text;
    }
    return undefined;
  }

  private answer(
    socket: StreamSocket,
    sessionId: string,
    text: string | undefined,
  ): void {
    const list = this.waiters.get(socket)?.get(sessionId);
    for (const settle of [...(list ?? [])]) settle(text);
  }
}

/**
 * The hotwords a turn sends the recognizer: the user's own first, then what the
 * conversation learned, deduplicated case-insensitively and cut at the same
 * ceiling the socket enforces on the user's list alone.
 *
 * User terms first because they were chosen; learned ones fill what is left,
 * and when they do not all fit it is the NEWEST that stay — `learned` is
 * oldest first, so cutting its tail would drop exactly the words the
 * conversation is saying now.
 * Undefined when there is nothing to send, which keeps the unbiased decoder
 * selected exactly as it was before anything was learned.
 */
export function mergeHotwords(
  user: readonly string[] | undefined,
  learned: readonly string[] | undefined,
): string[] | undefined {
  const seen = new Set<string>();
  const fresh = (terms: readonly string[] | undefined): string[] =>
    (terms ?? []).filter((term) => {
      const key = term.trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const chosen = fresh(user).slice(0, CONTEXT_LIMITS.MAX_HOTWORDS);
  const room = CONTEXT_LIMITS.MAX_HOTWORDS - chosen.length;
  const merged = [...chosen, ...(room > 0 ? fresh(learned).slice(-room) : [])];
  return merged.length > 0 ? merged : undefined;
}
