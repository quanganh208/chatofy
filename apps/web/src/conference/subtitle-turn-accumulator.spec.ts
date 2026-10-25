import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SubtitleTurnAccumulator,
  TURN_QUIET_GAP_MS,
  type SubtitleTurnFrame,
} from './subtitle-turn-accumulator';

function setup(options: { maxChars?: number } = {}) {
  const frames: SubtitleTurnFrame[] = [];
  const open: boolean[] = [];
  let n = 0;
  const turns = new SubtitleTurnAccumulator({
    onFrame: (frame) => frames.push(frame),
    onTurnOpenChange: (value) => open.push(value),
    newTurnId: () => `turn-${++n}`,
    ...options,
  });
  return { turns, frames, open };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('SubtitleTurnAccumulator', () => {
  it('sends each delta as a cumulative, provisional frame of one turn', () => {
    const { turns, frames } = setup();
    turns.push('source', 'xin ');
    turns.push('source', 'chào');
    turns.push('target', 'hello');

    expect(frames).toEqual([
      { turnId: 'turn-1', sourceText: 'xin ', translatedText: '', isFinal: false },
      { turnId: 'turn-1', sourceText: 'xin chào', translatedText: '', isFinal: false },
      { turnId: 'turn-1', sourceText: 'xin chào', translatedText: 'hello', isFinal: false },
    ]);
  });

  it('closes the turn with exactly one final frame after the quiet gap', () => {
    const { turns, frames } = setup();
    turns.push('source', 'xin chào');
    turns.push('target', 'hello');

    vi.advanceTimersByTime(TURN_QUIET_GAP_MS - 1);
    expect(frames.filter((f) => f.isFinal)).toEqual([]);

    vi.advanceTimersByTime(1);
    vi.advanceTimersByTime(TURN_QUIET_GAP_MS * 3);
    expect(frames.filter((f) => f.isFinal)).toEqual([
      { turnId: 'turn-1', sourceText: 'xin chào', translatedText: 'hello', isFinal: true },
    ]);
  });

  it('keeps a turn open while either channel is still moving', () => {
    const { turns, frames } = setup();
    turns.push('source', 'a');
    vi.advanceTimersByTime(TURN_QUIET_GAP_MS - 100);
    turns.push('target', 'b');
    vi.advanceTimersByTime(TURN_QUIET_GAP_MS - 100);

    expect(frames.some((f) => f.isFinal)).toBe(false);
    expect(new Set(frames.map((f) => f.turnId))).toEqual(new Set(['turn-1']));
  });

  it('starts a fresh turn id for the first delta after a turn closed', () => {
    const { turns, frames } = setup();
    turns.push('source', 'one');
    vi.advanceTimersByTime(TURN_QUIET_GAP_MS);
    turns.push('source', 'two');

    expect(frames.at(-1)).toEqual({
      turnId: 'turn-2',
      sourceText: 'two',
      translatedText: '',
      isFinal: false,
    });
  });

  it('reports the turn open from its first delta until it closes', () => {
    const { turns, open } = setup();
    turns.push('source', 'a');
    turns.push('target', 'b');
    expect(open).toEqual([true]);
    vi.advanceTimersByTime(TURN_QUIET_GAP_MS);
    expect(open).toEqual([true, false]);
  });

  it('closes on demand, once, and not at all with nothing open', () => {
    const { turns, frames } = setup();
    turns.close();
    expect(frames).toEqual([]);

    turns.push('target', 'hi');
    turns.close();
    turns.close();
    vi.advanceTimersByTime(TURN_QUIET_GAP_MS);
    expect(frames.filter((f) => f.isFinal)).toHaveLength(1);
  });

  it('ignores empty deltas, which carry nothing to show', () => {
    const { turns, frames, open } = setup();
    turns.push('source', '');
    expect(frames).toEqual([]);
    expect(open).toEqual([]);
  });

  it('closes a turn before it outgrows the per-turn cap and carries on in the next', () => {
    const { turns, frames } = setup({ maxChars: 5 });
    turns.push('source', 'abc');
    turns.push('source', 'def');

    expect(frames).toEqual([
      { turnId: 'turn-1', sourceText: 'abc', translatedText: '', isFinal: false },
      { turnId: 'turn-1', sourceText: 'abc', translatedText: '', isFinal: true },
      { turnId: 'turn-2', sourceText: 'def', translatedText: '', isFinal: false },
    ]);
  });
});
