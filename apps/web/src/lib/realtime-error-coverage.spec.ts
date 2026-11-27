import { describe, expect, it } from 'vitest';
import { en, realtimeErrorKey, vi as viMessages, zh } from '@chatofy/i18n';
import { REALTIME_CLIENT_ERROR_CODES } from '@chatofy/realtime-client';
import { SERVER_ERROR_CODES } from '@chatofy/types';

/**
 * Every code a live-translation failure can arrive with has a sentence in every
 * locale. `realtimeErrorKey` lives in `@chatofy/i18n`, which depends on neither
 * catalogue; this app depends on all three, so the check that they agree lives here.
 */
const CODES = [...SERVER_ERROR_CODES, ...REALTIME_CLIENT_ERROR_CODES];

/** Faults a reader cannot act on, worded with the generic sentence on purpose. */
const GENERIC_ON_PURPOSE = new Set<string>([
  'no_active_session',
  'frame_rejected',
  'session_busy',
  'unsupported_audio',
  'connection_error',
  'unreadable_event',
]);

describe('realtime error codes', () => {
  it.each(CODES)('%s has a sentence in en, vi and zh', (code) => {
    const key = realtimeErrorKey({ code });
    for (const messages of [en, viMessages, zh]) {
      expect(messages[key].trim().length, `${code} -> ${key}`).toBeGreaterThan(0);
    }
  });

  it('gives a code its own sentence unless it is listed as generic on purpose', () => {
    const generic = CODES.filter(
      (code) => realtimeErrorKey({ code }) === 'common.realtime.generic',
    );
    expect(new Set(generic)).toEqual(GENERIC_ON_PURPOSE);
  });

  it('keeps the client codes apart from the server codes, so one field can carry either', () => {
    const server = new Set<string>(SERVER_ERROR_CODES);
    expect(REALTIME_CLIENT_ERROR_CODES.filter((code) => server.has(code))).toEqual([]);
  });
});
