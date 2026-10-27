import type { ConversationRuntimeOptions } from './conversation-session.js';

/**
 * How the cascade runs for a person talking hands-free: the /translate page and
 * both conference speaker legs read these, so the tuning has one source.
 *
 * This is the shared base. A caller that needs something different overrides a
 * field explicitly by spreading it — `{ ...CASCADE_RUNTIME_OPTIONS, field }` —
 * and says why beside the override. The conference leg does exactly that for
 * `ownsEchoMeasurement`: its playback goes to other people, so "our audio is
 * out" is not "our audio is sounding here".
 *
 * The extension keeps its own runtime object on purpose; its capture and
 * playback are arranged differently and its ceiling differs.
 */

/** Turns open at the server at once. Matches the server's per-socket ceiling; higher only earns `too_many_turns`. */
export const CASCADE_MAX_IN_FLIGHT = 3;

/**
 * Longest a single turn may run before it is cut.
 *
 * Continuous capture needs one: in a real conversation people speak for tens of
 * seconds without ever leaving a full hangover of silence, so a gate that only
 * ends turns on silence would open one turn and never close it. 8s matches the
 * extension, which has run this configuration on real calls.
 *
 * It has a measurement consequence worth stating where the value is set: it
 * RIGHT-CENSORS the turn-length distribution, so "how many turns run past N
 * seconds" is partly a property of this constant. Anything reading that
 * distribution has to report the ceiling beside it and treat `cutForced` turns
 * as censored rather than as observations.
 */
export const CASCADE_MAX_UTTERANCE_MS = 8_000;

export const CASCADE_RUNTIME_OPTIONS: Readonly<ConversationRuntimeOptions> = Object.freeze({
  // The microphone is honoured while our own translation plays, so someone
  // may talk over it and be heard. What this costs is an acoustic loop —
  // loudspeaker into microphone, and the app translates its own voice — and
  // whether that loop closes is a property of the device, not of the code.
  // Switched on for the laptop this is developed and demonstrated on, whose
  // built-in cancellation holds: playback was verified never to reopen the
  // gate while someone was speaking. `echoHeard` is what says otherwise on a
  // machine where it does not hold, and it is on screen the moment it moves.
  fullDuplex: true,
  // Capture does not stop between turns either: the microphone is no longer
  // shut for the whole turn cycle waiting to be re-armed.
  continuous: true,
  maxInFlight: CASCADE_MAX_IN_FLIGHT,
  maxUtteranceMs: CASCADE_MAX_UTTERANCE_MS,
  // Per-turn rows for the server's metrics log. The turn-length distribution and the
  // request-per-model rate are computed from these, and both are client
  // facts: the server cannot know when someone began speaking, nor when a
  // loudspeaker produced sound. Always sent; the server only logs them.
  reportMetrics: true,
});

/**
 * Ask the server for settled text (`server.transcript.delta`) on every start.
 *
 * Asked for rather than defaulted on the server, because the client union is
 * strict: a build that predates the event would report a parse failure once
 * per round instead of ignoring it. Only a client that knows the event asks for
 * it, and every cascade client here is that client.
 */
export const CASCADE_STREAM_COMMITTED = true;
