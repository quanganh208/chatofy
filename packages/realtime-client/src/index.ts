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

// The continuous speech-to-speech path. A sibling of the turn machinery above,
// sharing the capture format and the playback leaf and nothing else — see the
// class comment on `LiveSession` for why the gate must not reach it.
export { LiveTranslateSocket, liveTranslateSocketUrl } from './transport/live-translate-socket.js';
export type { LiveTranslateSocketHandlers } from './transport/live-translate-socket.js';
export { LiveSession } from './conversation/live-session.js';
export type {
  LiveSessionDeps,
  LiveSessionListeners,
  LiveSessionStatus,
} from './conversation/live-session.js';

// The playback leaf, for a caller whose output device is not this machine's
// loudspeakers. `PlaybackSink` is the contract `ConversationSession.deps
// .createPlaybackSink` accepts; `PcmPlaybackQueue` is the implementation that
// schedules on a Web Audio clock, exported so a sink living in another context
// can reuse the scheduling rather than growing a second copy of it.
export { PcmPlaybackQueue } from './audio/pcm-playback-queue.js';
export type { PlaybackSink } from './audio/ordered-playback.js';

// Microphone capture with no turn-taking policy attached, for the live path.
// `CapturePump` is the other half of this choice and is deliberately NOT what
// the live path uses: it withholds audio outside a confirmed utterance, which
// truncates a translation the backend ends from trailing quiet.
export { MicrophoneGraph } from './audio/microphone-graph.js';
export type { MicrophoneBlockHandler, MicrophoneGraphDeps } from './audio/microphone-graph.js';
export {
  base64ToPcm16,
  downsampleToPcm16,
  pcm16Rms,
  pcm16ToBase64,
} from './audio/pcm-resampler.js';

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
