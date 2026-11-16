import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseThemeChoice } from './remembered-theme-value.ts';

describe('parseThemeChoice', () => {
  it('keeps a stored light or dark choice', () => {
    assert.equal(parseThemeChoice('light'), 'light');
    assert.equal(parseThemeChoice('dark'), 'dark');
  });

  it('falls back to system for nothing or anything unknown', () => {
    assert.equal(parseThemeChoice(null), 'system');
    assert.equal(parseThemeChoice('system'), 'system');
    assert.equal(parseThemeChoice('sepia'), 'system');
  });
});
