import { describe, expect, it } from 'vitest';
import { en } from '@chatofy/i18n';
import { ReaderFacingError, readerMessage, sessionFailureMessage } from './reader-facing-error';

describe('readerMessage', () => {
  it('shows a sentence the extension wrote for the reader', () => {
    expect(
      readerMessage(
        new ReaderFacingError('Bạn đăng nhập trước nhé'),
        'common.realtime.startFailed',
      ),
    ).toBe('Bạn đăng nhập trước nhé');
  });

  it('never shows the English of an error it did not write', () => {
    // Chrome's own wording for a tab that cannot be captured.
    const chrome = new Error('Cannot capture a tab with an active stream.');
    expect(readerMessage(chrome, 'extension.error.tabCaptureFailed')).toBe(
      en['extension.error.tabCaptureFailed'],
    );
    expect(readerMessage('a bare string', 'common.realtime.startFailed')).toBe(
      en['common.realtime.startFailed'],
    );
  });
});

describe('sessionFailureMessage', () => {
  const opened = { turnOpened: true };

  it('words a server or client failure by its code, never by its message', () => {
    expect(sessionFailureMessage({ source: 'server', code: 'turn_failed' }, opened)).toBe(
      en['common.realtime.turnFailed'],
    );
    expect(sessionFailureMessage({ source: 'client', code: 'connection_failed' }, opened)).toBe(
      en['common.realtime.unreachable'],
    );
    expect(sessionFailureMessage({ source: 'server', code: 'a_code_added_later' }, opened)).toBe(
      en['common.realtime.generic'],
    );
  });

  it('keeps the credit wording that knows whether a turn opened', () => {
    expect(
      sessionFailureMessage({ source: 'server', code: 'credits_exhausted' }, { turnOpened: false }),
    ).toBe(en['common.billing.startRefused']);
    expect(sessionFailureMessage({ source: 'server', code: 'credits_exhausted' }, opened)).toBe(
      en['extension.credits.exhausted'],
    );
  });
});
