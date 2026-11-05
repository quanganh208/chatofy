import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MicLock } from './mic-lock.ts';

describe('MicLock', () => {
  it('grants the first asker and refuses the second without stopping the first', () => {
    const lock = new MicLock();
    assert.equal(lock.acquire('conference'), true);
    assert.equal(lock.acquire('translate'), false);
    assert.equal(lock.heldBy(), 'conference');
  });

  it('is idempotent for the holder', () => {
    const lock = new MicLock();
    assert.equal(lock.acquire('translate'), true);
    assert.equal(lock.acquire('translate'), true);
  });

  it('lets a release free only its own lock', () => {
    const lock = new MicLock();
    lock.acquire('conference');
    lock.release('translate');
    assert.equal(lock.heldBy(), 'conference');
    lock.release('conference');
    assert.equal(lock.heldBy(), null);
    assert.equal(lock.acquire('translate'), true);
  });

  it('says whether the release freed anything, so an idle stop has nothing to clean up', () => {
    const lock = new MicLock();
    assert.equal(lock.release('translate'), false);
    lock.acquire('conference');
    assert.equal(lock.release('translate'), false);
    lock.acquire('conference');
    assert.equal(lock.release('conference'), true);
    assert.equal(lock.release('conference'), false);
  });

  it('tells subscribers when ownership changes', () => {
    const lock = new MicLock();
    let calls = 0;
    const off = lock.subscribe(() => (calls += 1));
    lock.acquire('translate');
    lock.release('translate');
    off();
    lock.acquire('translate');
    assert.equal(calls, 2);
  });
});
