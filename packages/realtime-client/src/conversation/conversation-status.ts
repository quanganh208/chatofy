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
  'idle' | 'connecting' | 'listening' | 'hearing-speech' | 'translating' | 'playing';
