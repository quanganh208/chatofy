import type { MessageKey } from './en.js';

/**
 * The sentence for a live-translation failure, chosen by its code.
 *
 * Both the server's `server.error` codes and the realtime client's own codes
 * arrive with an English `message` that is for logs only: a reader in any
 * locale is told the failure from this table. Kept here, beside the strings,
 * so web, mobile and the extension cannot word the same code three ways.
 *
 * Takes plain strings rather than the code unions from `@chatofy/types` and
 * `@chatofy/realtime-client`, because this package has no dependencies; the
 * apps' specs check every code in those catalogues against this table.
 *
 * The credit codes have entries so the table is total, but an app with more
 * context — whether a turn had opened, how many credits are left — words them
 * itself first.
 */
const KEY_BY_CODE: ReadonlyMap<string, MessageKey> = new Map<string, MessageKey>(
  Object.entries({
    // Server codes.
    credits_exhausted: 'common.billing.exhausted',
    credits_low: 'common.billing.lowUnknown',
    credits_unavailable: 'common.billing.unavailable',
    client_outdated: 'common.realtime.outdated',
    too_many_turns: 'common.realtime.busy',
    language_unavailable: 'common.realtime.languageUnavailable',
    turn_too_long: 'common.realtime.turnTooLong',
    no_audio: 'common.realtime.noSpeech',
    turn_abandoned: 'common.realtime.noSpeech',
    turn_failed: 'common.realtime.turnFailed',
    // `no_active_session`, `frame_rejected`, `session_busy` and `unsupported_audio`
    // are protocol faults a reader cannot act on, so they take the generic sentence.

    // Realtime client codes.
    connection_failed: 'common.realtime.unreachable',
    connection_lost: 'common.realtime.connectionLost',
    connection_closed: 'common.realtime.connectionLost',
    start_failed: 'common.realtime.startFailed',
    // `connection_error` and `unreadable_event` take the generic sentence too.
  } satisfies Record<string, MessageKey>),
);

/**
 * Why Auto-detect could not run, under `language_unavailable`. Each names the
 * next step, where the bare code could only say the language is unavailable.
 */
const LANGUAGE_DETAIL_KEY: ReadonlyMap<string, MessageKey> = new Map<string, MessageKey>([
  ['language_detection', 'web.translate.detectUnavailable'],
  ['lid_capacity', 'web.translate.detectBusy'],
]);

/** What `realtimeErrorKey` reads: the code, and the server's finer reason if any. */
export interface RealtimeErrorCodeRef {
  code: string;
  detail?: string;
}

/**
 * A Map rather than an object lookup: a code is untrusted wire text, and
 * "constructor" must not find `Object.prototype`.
 */
export function realtimeErrorKey(cause: RealtimeErrorCodeRef | undefined): MessageKey {
  if (cause === undefined) return 'common.realtime.generic';
  if (cause.code === 'language_unavailable' && cause.detail !== undefined) {
    const detailed = LANGUAGE_DETAIL_KEY.get(cause.detail);
    if (detailed) return detailed;
  }
  return KEY_BY_CODE.get(cause.code) ?? 'common.realtime.generic';
}
