import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUuidV4 } from './crypto-random-uuid.ts';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('crypto.randomUUID polyfill', () => {
  it('mints RFC 4122 version 4 ids', () => {
    for (let i = 0; i < 200; i += 1) assert.match(randomUuidV4(), UUID_V4);
  });

  it('does not replace a runtime that already has one', () => {
    // Node ships Web Crypto, so importing the polyfill must have left it alone.
    assert.notEqual(globalThis.crypto.randomUUID, randomUuidV4);
    assert.match(globalThis.crypto.randomUUID(), UUID_V4);
  });
});
