import { describe, expect, it } from 'vitest';
import { firstFailure } from '../entrypoints/popup/popup-status';
import { t } from './i18n';
import type { OverlayState } from './messages';

/**
 * The popup's footer has room for one failure, so the order is the rule: the
 * capture first (nothing else can be true without it), then the meeting's audio,
 * then the user's microphone — the offscreen leg before the worker's relay.
 */
const withErrors = (errors: OverlayState['errors']): OverlayState => ({
  capturing: true,
  lines: [],
  outbound: 'sending',
  errors,
});

describe('firstFailure', () => {
  it('names a relay failure as a microphone failure', () => {
    expect(firstFailure(withErrors({ relay: 'tab lost' }))).toBe(
      t('extension.status.microphoneError', { error: 'tab lost' }),
    );
  });

  it('puts the outbound leg ahead of the relay', () => {
    expect(firstFailure(withErrors({ outbound: 'mic refused', relay: 'tab lost' }))).toBe(
      t('extension.status.microphoneError', { error: 'mic refused' }),
    );
  });

  it('puts capture and the meeting audio ahead of the relay', () => {
    expect(firstFailure(withErrors({ capture: 'tab went away', relay: 'tab lost' }))).toBe(
      'tab went away',
    );
    expect(firstFailure(withErrors({ inbound: 'dropped', relay: 'tab lost' }))).toBe(
      t('extension.status.meetingAudioError', { error: 'dropped' }),
    );
  });

  it('says nothing when nothing failed', () => {
    expect(firstFailure(withErrors({}))).toBeUndefined();
    expect(firstFailure(undefined)).toBeUndefined();
  });
});
