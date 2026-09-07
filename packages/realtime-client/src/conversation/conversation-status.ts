/**
 * What the user is currently doing, or having done for them.
 *
 * Part of the hook's exported contract (`UseStreamingTranslate.status`), but
 * declared here rather than in the hook: the session class reports status, and
 * the hook consumes the class, so keeping the type in the hook would make the
 * two import each other.
 * @public
 */
export type ConversationStatus =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'hearing-speech'
  | 'translating'
  | 'playing'
  /**
   * The microphone is off but the conversation is not over: the socket, the
   * audio context and every turn still in flight are alive, and `resume()` puts
   * capture back without a new handshake.
   *
   * Deliberately NOT `idle`. Consumers read "running" as "not idle" — the web
   * panel does at `cascade-panel.tsx` — and the conversation save fires on the
   * falling edge of that, stamping an end time once. A pause that reported
   * `idle` would file the conversation as finished halfway through it.
   *
   * Sticky while it lasts: see `ConversationSession.pause`, which holds this
   * against the status the tail of playback would otherwise keep overwriting.
   */
  | 'paused'
  /**
   * The conversation is ending, and has not finished ending.
   *
   * The microphone is already off — that part is immediate — but the last thing
   * said is still being translated and spoken. Ending a conversation used to cut
   * all three at once: capture, the turn the server was still translating, and
   * whatever was mid-word in the loudspeaker.
   *
   * Ends at `idle` on its own, once nothing is left to play. Asking to end a
   * second time from here cuts it short deliberately.
   */
  | 'finishing';
