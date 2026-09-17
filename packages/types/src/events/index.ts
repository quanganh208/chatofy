export { WS_SUBPROTOCOL, tokenFromSubprotocols } from './ws-handshake.js';

export {
  audioEncodingSchema,
  audioFrameSchema,
  MAX_SAMPLE_RATE,
  MIN_SAMPLE_RATE,
} from './audio-frame.js';
export type { AudioEncoding, AudioFrame } from './audio-frame.js';

export {
  clientEventSchema,
  countTermWords,
  glossaryEntrySchema,
  MAX_GLOSSARY_TERM_WORDS,
  serverEventSchema,
  sessionOptionsSchema,
  translationHintsSchema,
  turnOutcomeSchema,
} from './ws-events.js';
export type {
  ClientEvent,
  ClientTurnMetrics,
  GlossaryEntry,
  ServerEvent,
  SessionOptions,
  TranslationHints,
  TurnOutcome,
} from './ws-events.js';

// The continuous speech-to-speech path. Deliberately a separate union from the
// turn contract above — see the header of live-ws-events.ts.
export {
  liveClientEventSchema,
  liveServerEventSchema,
  MAX_LIVE_ERROR_MESSAGE_CHARS,
} from './live-ws-events.js';
export type { LiveClientEvent, LiveServerEvent } from './live-ws-events.js';
