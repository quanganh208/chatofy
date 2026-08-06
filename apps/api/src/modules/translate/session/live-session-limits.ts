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
