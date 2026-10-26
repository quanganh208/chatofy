import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  TranslationAudioResequencer,
  type ResequencerTimers,
} from './translation-audio-resequencer.ts';

function manualTimers() {
  let now = 0;
  let nextId = 1;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const timers: ResequencerTimers = {
    set: (fn, ms) => {
      const id = nextId++;
      pending.set(id, { at: now + ms, fn });
      return id;
    },
    clear: (handle) => {
      pending.delete(handle as number);
    },
  };
  const advance = (ms: number) => {
    now += ms;
    for (const [id, t] of [...pending]) {
      if (t.at <= now) {
        pending.delete(id);
        t.fn();
      }
    }
  };
  return { timers, advance, pendingCount: () => pending.size };
}

function setup(maxBufferedFrames?: number) {
  const clock = manualTimers();
  const played: [string, number][] = [];
  const seq = new TranslationAudioResequencer<number>({
    play: (speaker, frame) => played.push([speaker, frame]),
    timers: clock.timers,
    maxBufferedFrames,
  });
  return { seq, played, ...clock };
}

describe('TranslationAudioResequencer', () => {
  it('starts at the first sequence seen, not zero (late joiner)', () => {
    const { seq, played } = setup();
    seq.push('a', 120, 120);
    seq.push('a', 121, 121);
    assert.deepEqual(played, [
      ['a', 120],
      ['a', 121],
    ]);
  });

  it('reorders an early frame once its predecessor arrives', () => {
    const { seq, played } = setup();
    seq.push('a', 5, 5);
    seq.push('a', 7, 7);
    seq.push('a', 6, 6);
    assert.deepEqual(
      played.map(([, f]) => f),
      [5, 6, 7],
    );
  });

  it('skips a gap that stays open for 500 ms', () => {
    const { seq, played, advance } = setup();
    seq.push('a', 0, 0);
    seq.push('a', 2, 2);
    seq.push('a', 3, 3);
    advance(499);
    assert.deepEqual(
      played.map(([, f]) => f),
      [0],
    );
    advance(1);
    assert.deepEqual(
      played.map(([, f]) => f),
      [0, 2, 3],
    );
    // The skipped frame arriving late is dropped, not replayed out of order.
    seq.push('a', 1, 1);
    assert.deepEqual(
      played.map(([, f]) => f),
      [0, 2, 3],
    );
  });

  it('skips immediately when more than the cap is buffered', () => {
    const { seq, played } = setup(3);
    seq.push('a', 0, 0);
    for (const s of [2, 3, 4, 5]) seq.push('a', s, s);
    assert.deepEqual(
      played.map(([, f]) => f),
      [0, 2, 3, 4, 5],
    );
  });

  it('drops duplicates', () => {
    const { seq, played } = setup();
    seq.push('a', 1, 1);
    seq.push('a', 1, 1);
    seq.push('a', 3, 3);
    seq.push('a', 3, 3);
    seq.push('a', 2, 2);
    assert.deepEqual(
      played.map(([, f]) => f),
      [1, 2, 3],
    );
  });

  it('keeps speakers independent', () => {
    const { seq, played } = setup();
    seq.push('a', 10, 10);
    seq.push('b', 0, 100);
    seq.push('b', 2, 102);
    seq.push('a', 11, 11);
    assert.deepEqual(played, [
      ['a', 10],
      ['b', 100],
      ['a', 11],
    ]);
  });

  it('restarts the cursor when a speaker counter starts over', () => {
    const { seq, played } = setup(5);
    seq.push('a', 100, 100);
    seq.push('a', 0, 0);
    seq.push('a', 1, 1);
    assert.deepEqual(
      played.map(([, f]) => f),
      [100, 0, 1],
    );
  });

  it('removeSpeaker and clear cancel pending gap timers', () => {
    const { seq, played, advance, pendingCount } = setup();
    seq.push('a', 0, 0);
    seq.push('a', 2, 2);
    seq.push('b', 0, 0);
    seq.push('b', 5, 5);
    assert.equal(pendingCount(), 2);
    seq.removeSpeaker('a');
    assert.equal(pendingCount(), 1);
    seq.clear();
    assert.equal(pendingCount(), 0);
    advance(1000);
    assert.deepEqual(played, [
      ['a', 0],
      ['b', 0],
    ]);
  });

  it('ignores invalid sequences', () => {
    const { seq, played } = setup();
    seq.push('a', -1, -1);
    seq.push('a', 1.5, 1);
    assert.deepEqual(played, []);
  });
});
