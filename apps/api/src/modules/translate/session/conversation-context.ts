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

export class ConversationContext {
  private readonly recent = new WeakMap<StreamSocket, string[]>();

  /**
   * The finished utterances a turn starting now should be translated against.
   *
   * A fresh array every call: the caller hands it to the pipeline, which hands
   * it to a provider, and handing out the live ring would let a turn that
   * finishes mid-flight change what an in-flight prompt was built from.
   */
  recall(socket: StreamSocket): string[] {
    return [...(this.recent.get(socket) ?? [])];
  }

  /**
   * Record a turn's source text, once that turn has actually produced one.
   *
   * Called at the point the transcript is final, not when the turn opened, which
   * is what makes the list "finished" rather than "preceding". Order is
   * COMPLETION order: turns run concurrently and one can overtake another, and
   * the alternative — holding a slot for a turn still in flight — would mean a
   * fragment waiting on the very turn whose slowness left it without context.
   *
   * An empty or blank text is not recorded. A turn the recognizer returned
   * nothing for has no sentence to contribute, and a blank line of "earlier
   * speech" tells the model something was said and declines to say what.
   */
  remember(socket: StreamSocket, sourceText: string): void {
    const text = sourceText.trim();
    if (!text) return;
    const kept = this.recent.get(socket) ?? [];
    kept.push(text);
    while (kept.length > REMEMBERED_UTTERANCES) kept.shift();
    this.recent.set(socket, kept);
  }

  /** Drop a connection's history, for a socket that went away. */
  forget(socket: StreamSocket): void {
    this.recent.delete(socket);
  }
}
