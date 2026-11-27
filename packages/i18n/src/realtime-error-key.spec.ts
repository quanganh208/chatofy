import { describe, expect, it } from 'vitest';
import { en } from './en.js';
import { realtimeErrorKey } from './realtime-error-key.js';

describe('realtimeErrorKey', () => {
  it('words each code that has its own sentence', () => {
    expect(realtimeErrorKey({ code: 'turn_failed' })).toBe('common.realtime.turnFailed');
    expect(realtimeErrorKey({ code: 'connection_failed' })).toBe('common.realtime.unreachable');
    expect(realtimeErrorKey({ code: 'connection_lost' })).toBe('common.realtime.connectionLost');
    expect(realtimeErrorKey({ code: 'connection_closed' })).toBe('common.realtime.connectionLost');
    expect(realtimeErrorKey({ code: 'client_outdated' })).toBe('common.realtime.outdated');
    expect(realtimeErrorKey({ code: 'credits_exhausted' })).toBe('common.billing.exhausted');
    expect(realtimeErrorKey({ code: 'credits_low' })).toBe('common.billing.lowUnknown');
  });

  it('names the next step when Auto-detect is what was unavailable', () => {
    expect(realtimeErrorKey({ code: 'language_unavailable', detail: 'language_detection' })).toBe(
      'web.translate.detectUnavailable',
    );
    expect(realtimeErrorKey({ code: 'language_unavailable', detail: 'lid_capacity' })).toBe(
      'web.translate.detectBusy',
    );
    expect(realtimeErrorKey({ code: 'language_unavailable', detail: 'something_new' })).toBe(
      'common.realtime.languageUnavailable',
    );
  });

  it('says a turn that heard nothing as nothing to translate, not as a failure', () => {
    expect(realtimeErrorKey({ code: 'turn_failed', detail: 'no_speech' })).toBe(
      'common.realtime.noSpeech',
    );
    // The detail means something only under the code it was sent with.
    expect(realtimeErrorKey({ code: 'language_unavailable', detail: 'no_speech' })).toBe(
      'common.realtime.languageUnavailable',
    );
    expect(realtimeErrorKey({ code: 'turn_failed', detail: 'lid_capacity' })).toBe(
      'common.realtime.turnFailed',
    );
  });

  it('gives an unknown or missing code the generic sentence, never undefined', () => {
    expect(realtimeErrorKey({ code: 'a_code_added_later' })).toBe('common.realtime.generic');
    expect(realtimeErrorKey({ code: 'constructor' })).toBe('common.realtime.generic');
    expect(realtimeErrorKey({ code: '__proto__' })).toBe('common.realtime.generic');
    expect(realtimeErrorKey(undefined)).toBe('common.realtime.generic');
  });

  it('only ever answers a key the dictionary has', () => {
    const codes = ['turn_failed', 'no_audio', 'frame_rejected', 'start_failed', 'x'];
    for (const code of codes) expect(en[realtimeErrorKey({ code })]).toBeTypeOf('string');
  });
});
