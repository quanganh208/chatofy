import { describe, expect, it } from 'vitest';
import { microphoneFailureKey } from './microphone-failure';

describe('microphoneFailureKey', () => {
  it.each([
    ['NotAllowedError', 'extension.microphone.refused'],
    ['NotFoundError', 'extension.microphone.notFound'],
    ['NotReadableError', 'extension.microphone.inUse'],
    ['AbortError', 'extension.microphone.inUse'],
    ['OverconstrainedError', 'extension.microphone.openFailed'],
    ['SecurityError', 'extension.microphone.openFailed'],
  ])('maps %s', (name, key) => {
    expect(microphoneFailureKey(new DOMException('English browser text', name))).toBe(key);
  });

  it('falls back for anything that is not a DOMException', () => {
    expect(microphoneFailureKey(new Error('NotAllowedError'))).toBe(
      'extension.microphone.openFailed',
    );
    expect(microphoneFailureKey('boom')).toBe('extension.microphone.openFailed');
  });
});
