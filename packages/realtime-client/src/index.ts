/**
 * The realtime translation client, shared by every app that opens
 * `/ws/translate`.
 *
 * Extracted from `apps/web` rather than copied into the extension. The reason is
 * recorded in the code it wraps: `SpeechGate.push()` returns `isSpeech` so that
 * `CapturePump` does not re-derive the threshold, because "two copies of the
 * threshold would drift". The same argument applies one level up — two copies of
 * the whole turn-taking policy would drift, and the policy is where this project's
 * most expensive defects have lived.
 *
 * What is deliberately NOT here: `conversation-state.ts`. It keeps exactly one
 * `liveText` for a whole conversation and clears it on any turn's end, which is
 * correct for the one-turn web page and wrong for concurrent turns. Sharing it
 * would force a branch inside it, which is the opposite of the reason this
 * package exists. It stays in `apps/web`.
 */

export { ConversationSession } from './conversation/conversation-session.js';
export type {
  ConversationRuntimeOptions,
  ConversationSessionDeps,
  ConversationSessionListeners,
} from './conversation/conversation-session.js';
export type { ConversationStatus } from './conversation/conversation-status.js';
export { TranslateSocket, translateSocketUrl } from './transport/translate-socket.js';
export type { TranslateSocketHandlers } from './transport/translate-socket.js';

// The turn-keyed transcript, for a client that runs several turns at once. The
// single-turn reducer in `apps/web/src/state/conversation-state.ts` stays there;
// see the note at the top of this file.
export {
  initialTurnKeyedTranscript,
  liveTurnsInOrder,
  turnKeyedTranscriptReducer,
} from './state/turn-keyed-transcript.js';
export type {
  LiveTurn,
  TurnKeyedAction,
  TurnKeyedTranscript,
} from './state/turn-keyed-transcript.js';
