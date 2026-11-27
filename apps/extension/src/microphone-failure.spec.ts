import { describe, expect, it } from 'vitest';
import { en, vi, zh } from '@chatofy/i18n';
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

describe('sentences about a browser failure', () => {
  // The browser's text is English whatever the reader's language, so none of
  // these sentences may take it as a placeholder: a caller cannot fill one in.
  it.each([
    'extension.microphone.refused',
    'extension.microphone.notFound',
    'extension.microphone.inUse',
    'extension.microphone.openFailed',
    'extension.error.preparePageFailed',
  ] as const)('%s has no placeholder in any language', (key) => {
    for (const messages of [en, vi, zh]) expect(messages[key]).not.toMatch(/\{\w+\}/);
  });
});
