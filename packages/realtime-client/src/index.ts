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
 * There used to be a second, single-turn reducer in `apps/web` — one `liveText`
 * for a whole conversation, cleared on any turn's end. It was deliberately kept
 * out of this package, because sharing it would have forced a branch inside it on
 * how many turns exist. It is gone now that the web page runs turns concurrently;
 * `turn-keyed-transcript.ts` here is what both clients use.
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

// The transcript, keyed by turn so several can be spoken at once. Every client
// uses it; see the note at the top of this file for the one it replaced.
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

// Who is in the conversation, and who said each turn. Session-scoped labels
// rather than identities: nothing here is persisted or linked to an account, and
// a reset drops all of it.
export {
  attributionFor,
  canRemoveSpeaker,
  speakerFor,
  MAX_SPEAKERS,
  UNATTRIBUTED,
} from './state/speaker-roster.js';
export type {
  AttributionOrigin,
  AttributionsBySession,
  SessionSpeaker,
  TurnAttribution,
} from './state/speaker-roster.js';

// How the labelling actually went. Derived from the state above rather than
// counted alongside it, and it never leaves the browser.
export { buildCentroids, suggestSpeaker, TAU_SUGGEST } from './state/speaker-centroids.js';
export type { EmbeddingsBySession, TurnEmbedding } from './state/speaker-centroids.js';
export { attributionStats, TAP_RATE_FLOOR } from './state/attribution-stats.js';
export type { AttributionStats, SuggestionOutcomes } from './state/attribution-stats.js';
