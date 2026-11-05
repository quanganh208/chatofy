import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isRunning, languageNameKey, oneWayNotice, statusKey } from './status-text.ts';

describe('statusKey', () => {
  it('has a sentence for the states a person sees', () => {
    assert.equal(statusKey('listening'), 'web.translate.listening');
    assert.equal(statusKey('playing'), 'web.translate.speaking');
    assert.equal(statusKey('finishing'), 'web.translate.finishing');
  });
});

describe('isRunning', () => {
  it('is false only when nothing is open', () => {
    assert.equal(isRunning('idle'), false);
    assert.equal(isRunning('paused'), true);
    assert.equal(isRunning('finishing'), true);
  });
});

describe('languageNameKey', () => {
  it('names each registry language', () => {
    assert.equal(languageNameKey('zh'), 'common.languageName.zh');
  });
});

describe('oneWayNotice', () => {
  const pair = { source: 'vi', target: 'en' } as const;

  it('explains a two-way start the server ran declared', () => {
    assert.deepEqual(oneWayNotice(pair, true, 'declared'), {
      key: 'web.translate.twoWayUnavailable',
      from: 'vi',
      to: 'en',
    });
  });

  it('says nothing when two-way held, was not asked, or Auto-detect is in use', () => {
    assert.equal(oneWayNotice(pair, true, 'two-way'), null);
    assert.equal(oneWayNotice(pair, false, 'declared'), null);
    assert.equal(oneWayNotice({ source: 'detect', target: 'en' }, true, 'declared'), null);
    assert.equal(oneWayNotice(pair, true, null), null);
  });
});
