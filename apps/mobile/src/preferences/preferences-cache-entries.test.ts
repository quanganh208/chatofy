import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  documentEntry,
  documentFromEntry,
  pendingEntry,
  pendingFromEntry,
} from './preferences-cache-entries.ts';

describe('pending entry', () => {
  const patch = { pairs: { mobile: { source: 'vi', target: 'en' } } } as const;

  it('round-trips for the same account', () => {
    assert.deepEqual(pendingFromEntry(pendingEntry('u1', patch), 'u1'), patch);
  });

  it('is ignored for another account', () => {
    assert.equal(pendingFromEntry(pendingEntry('u1', patch), 'u2'), null);
  });

  it('keeps a voice cleared with null', () => {
    const clear = { voices: { en: { voice: null } } };
    assert.deepEqual(pendingFromEntry(pendingEntry('u1', clear), 'u1'), clear);
  });

  it('drops a patch the contract no longer accepts, an empty one, or garbage', () => {
    assert.equal(pendingFromEntry(pendingEntry('u1', { theme: 'neon' } as never), 'u1'), null);
    assert.equal(pendingFromEntry(pendingEntry('u1', {}), 'u1'), null);
    assert.equal(pendingFromEntry(null, 'u1'), null);
    assert.equal(pendingFromEntry('"x"', 'u1'), null);
  });
});

describe('document entry', () => {
  it('reads back for the same account and reads as empty for another', () => {
    const raw = documentEntry('u1', { theme: 'dark' });
    assert.deepEqual(documentFromEntry(raw, 'u1'), { theme: 'dark' });
    assert.equal(documentFromEntry(raw, 'u2'), null);
    assert.equal(documentFromEntry(null, 'u1'), null);
  });
});
