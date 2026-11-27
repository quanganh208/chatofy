/**
 * How the realtime client names a failure, so each app can say it in its
 * reader's language.
 *
 * This package has no dictionary and must not grow one: it is shared by web,
 * mobile and the extension, and each says things its own way. So every failure
 * it reports carries a stable code beside its English message, and the message
 * is for logs only. An app maps the code to its copy, and a code it does not
 * know to a generic sentence — never to the message.
 */

/**
 * Failures the client itself detects, as opposed to the server's `server.error`
 * codes (`SERVER_ERROR_CODES` in `@chatofy/types`). None of these names is a
 * server code, so one `code` field can carry either kind.
 */
export const REALTIME_CLIENT_ERROR_CODES = [
  /** The socket's handshake never completed: the translator could not be reached. */
  'connection_failed',
  /** The socket dropped mid-conversation and no reconnect brought it back. */
  'connection_lost',
  /** The server closed the socket on purpose, with a 4000-4999 close code. */
  'connection_closed',
  /** The transport reported an error on a socket that had opened. */
  'connection_error',
  /** A frame from the server that is not JSON, or not an event the contract knows. */
  'unreadable_event',
  /** Anything else that stopped a start: the microphone, the audio graph, a worklet. */
  'start_failed',
] as const;
export type RealtimeClientErrorCode = (typeof REALTIME_CLIENT_ERROR_CODES)[number];

/** A failure the client detected, thrown or reported with its code attached. */
export class RealtimeClientError extends Error {
  readonly code: RealtimeClientErrorCode;

  constructor(code: RealtimeClientErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'RealtimeClientError';
    this.code = code;
  }
}

/**
 * What `onError` carries beside the message: always present with a message.
 *
 * `source` says whose code `code` is. A `server` code is one of the server's
 * `server.error` codes, with whatever optional fields it sent; a `client` code
 * is a {@link RealtimeClientErrorCode}.
 */
export interface RealtimeErrorCause {
  source: 'server' | 'client';
  code: string;
  /** A finer reason the server gave under `code`, such as `language_detection`. */
  detail?: string;
  /**
   * Credit-seconds the account had left when the server sent a credit code
   * (`credits_low`, `credits_exhausted`); absent on every other error. A client
   * fills its "about N credits left" copy from this.
   */
  remainingCreditSeconds?: number;
  /**
   * What a failed start threw, on `start_failed` only. An app whose own
   * `openMicrophone` throws an error already written in the reader's language
   * recognises it here, by its class, and shows it; anything else gets the
   * app's generic sentence.
   */
  thrown?: unknown;
}

/** The cause for a failure the client detected. */
export function clientErrorCause(
  code: RealtimeClientErrorCode,
  thrown?: unknown,
): RealtimeErrorCause {
  return thrown === undefined ? { source: 'client', code } : { source: 'client', code, thrown };
}
