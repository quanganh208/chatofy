/**
 * What bounds a continuous session, and why each number is what it is.
 *
 * Kept apart from `turn-concurrency.ts` because the resource being protected is
 * different in kind. A turn costs local CPU and a memory buffer; a live session
 * costs a long-lived socket to Google and metered quota, and it costs it for as
 * long as the session is open rather than for as long as the work takes. The
 * concurrency ceiling is still shared with the turn path — both are
 * unauthenticated and a limit each path could exhaust independently is not a
 * limit — but everything below is this path's own.
 */

/**
 * The per-frame payload bound lives with the contract, in
 * `@chatofy/types`'s `live-ws-events.ts`, so the schema and its limit cannot
 * drift apart. Only the session-wide ceiling below is this app's.
 */

/**
 * Microphone bytes one session may forward before it is closed.
 *
 * 16 kHz mono pcm16 is 32000 bytes a second, so this is about 30 minutes of
 * continuous audio. It is a quota ceiling rather than a memory one — the bytes
 * are forwarded, never retained — and it exists because the upstream's own
 * ephemeral-token window is about the same length, so a session that reaches
 * this has already outlived the credential it was opened with.
 */
export const MAX_LIVE_SESSION_INPUT_BYTES = 32000 * 60 * 30;

/**
 * How long the upstream has to answer a dial before the session is abandoned.
 *
 * The SDK sets no deadline of its own: `client.live.connect` awaits a promise
 * that only the websocket's `onopen` callback resolves, so a socket that is
 * accepted and then blackholed leaves it pending forever (verified in
 * `@google/genai` 2.16.0).
 *
 * That has to be bounded HERE rather than left to the idle sweep, because the
 * sweep cannot see it: it exempts sessions with no handle yet, which is exactly
 * what a session still dialing is. Without this a stalled dial holds its slot
 * for the life of the process, and `MAX_CONCURRENT_TURNS_GLOBAL` of them shut
 * the endpoint to everyone — on a path that takes no authentication.
 *
 * 15s against a measured dial of ~380 ms. Generous enough that a slow but real
 * connection is never cut, short enough that a stuck one is not a lost slot.
 */
export const LIVE_DIAL_TIMEOUT_MS = 15_000;
