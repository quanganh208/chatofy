import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TurnAccumulator, type TurnFrame, type TurnTimers } from './conference-turn-accumulator.ts';

/** Manual clock: timers fire only when the test advances time. */
function manualTimers() {
  let now = 0;
  let nextId = 1;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const timers: TurnTimers = {
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
  return { timers, advance };
}

function setup(maxTextChars?: number) {
  const { timers, advance } = manualTimers();
  const frames: TurnFrame[] = [];
  const active: boolean[] = [];
  let n = 0;
  const acc = new TurnAccumulator({
    newTurnId: () => `turn-${++n}`,
    emit: (f) => frames.push(f),
    onTurnActive: (a) => active.push(a),
    timers,
    maxTextChars,
  });
  return { acc, frames, active, advance };
}

describe('TurnAccumulator', () => {
  it('sends cumulative provisional frames and one final after the quiet gap', () => {
    const { acc, frames, active, advance } = setup();
    acc.push('source', 'Xin ');
    acc.push('source', 'chào');
    acc.push('target', 'Hello');
    advance(1499);
    assert.equal(frames.filter((f) => f.isFinal).length, 0);
    advance(1);

    assert.deepEqual(frames, [
      { turnId: 'turn-1', sourceText: 'Xin ', translatedText: '', isFinal: false },
      { turnId: 'turn-1', sourceText: 'Xin chào', translatedText: '', isFinal: false },
      { turnId: 'turn-1', sourceText: 'Xin chào', translatedText: 'Hello', isFinal: false },
      { turnId: 'turn-1', sourceText: 'Xin chào', translatedText: 'Hello', isFinal: true },
    ]);
    assert.deepEqual(active, [true, false]);
  });

  it('a delta on either channel keeps the turn open', () => {
    const { acc, frames, advance } = setup();
    acc.push('source', 'a');
    advance(1000);
    acc.push('target', 'b');
    advance(1000);
    assert.equal(
      frames.some((f) => f.isFinal),
      false,
    );
    advance(500);
    assert.equal(frames.filter((f) => f.isFinal).length, 1);
  });

  it('mints a new turn id for the delta after a closed turn', () => {
    const { acc, frames, advance } = setup();
    acc.push('source', 'one');
    advance(1500);
    acc.push('source', 'two');
    advance(1500);
    const finals = frames.filter((f) => f.isFinal);
    assert.deepEqual(
      finals.map((f) => [f.turnId, f.sourceText]),
      [
        ['turn-1', 'one'],
        ['turn-2', 'two'],
      ],
    );
  });

  it('close() finalises immediately and only once', () => {
    const { acc, frames, advance } = setup();
    acc.push('target', 'hi');
    acc.close();
    acc.close();
    advance(5000);
    assert.equal(frames.filter((f) => f.isFinal).length, 1);
    assert.equal(acc.active, false);
  });

  it('dispose() drops the open turn without a final frame', () => {
    const { acc, frames, active, advance } = setup();
    acc.push('source', 'hi');
    acc.dispose();
    advance(5000);
    assert.equal(
      frames.some((f) => f.isFinal),
      false,
    );
    assert.deepEqual(active, [true, false]);
  });

  it('ignores empty deltas', () => {
    const { acc, frames, active } = setup();
    acc.push('source', '');
    assert.equal(frames.length, 0);
    assert.equal(active.length, 0);
  });

  it('closes the turn early instead of outgrowing the text cap', () => {
    const { acc, frames } = setup(5);
    acc.push('source', 'abc');
    acc.push('source', 'def');
    assert.deepEqual(
      frames.map((f) => [f.turnId, f.sourceText, f.isFinal]),
      [
        ['turn-1', 'abc', false],
        ['turn-1', 'abc', true],
        ['turn-2', 'def', false],
      ],
    );
  });
});
