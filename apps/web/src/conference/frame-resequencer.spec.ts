import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FrameResequencer, GAP_TIMEOUT_MS } from './frame-resequencer';

function setup(options: { maxBuffered?: number } = {}) {
  const played: number[] = [];
  const resequencer = new FrameResequencer<string>({
    onFrame: (_frame, sequence) => played.push(sequence),
    ...options,
  });
  const push = (...sequences: number[]) =>
    sequences.forEach((sequence) => resequencer.push(sequence, `f${sequence}`));
  return { resequencer, played, push };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('FrameResequencer', () => {
  it('starts from the first sequence it sees, not from zero', () => {
    // A listener joining mid-call hears a session already well past frame 0.
    const { played, push } = setup();
    push(812, 813, 814);
    expect(played).toEqual([812, 813, 814]);
  });

  it('holds an early frame until the one before it arrives', () => {
    const { played, push } = setup();
    push(10, 12);
    expect(played).toEqual([10]);
    push(11);
    expect(played).toEqual([10, 11, 12]);
  });

  it('drops a duplicate or a frame older than what already played', () => {
    const { played, push } = setup();
    push(5, 6, 6, 4);
    expect(played).toEqual([5, 6]);
  });

  it('skips a frame that never arrives once the gap has waited long enough', () => {
    const { played, push } = setup();
    push(1, 3, 4);
    vi.advanceTimersByTime(GAP_TIMEOUT_MS - 1);
    expect(played).toEqual([1]);
    vi.advanceTimersByTime(1);
    expect(played).toEqual([1, 3, 4]);

    // And the stream carries on from there; the lost frame is not waited for again.
    push(2, 5);
    expect(played).toEqual([1, 3, 4, 5]);
  });

  it('does not let steady traffic behind a gap postpone skipping it', () => {
    const { played, push } = setup();
    push(1, 3);
    vi.advanceTimersByTime(GAP_TIMEOUT_MS / 2);
    push(4);
    vi.advanceTimersByTime(GAP_TIMEOUT_MS / 2);
    expect(played).toEqual([1, 3, 4]);
  });

  it('skips the gap at once when too many frames are held behind it', () => {
    const { played, push } = setup({ maxBuffered: 3 });
    push(1, 3, 4, 5);
    expect(played).toEqual([1]);
    push(6);
    expect(played).toEqual([1, 3, 4, 5, 6]);
  });

  it('plays nothing more after close', () => {
    const { resequencer, played, push } = setup();
    push(1, 3);
    resequencer.close();
    vi.advanceTimersByTime(GAP_TIMEOUT_MS * 2);
    expect(played).toEqual([1]);
  });
});
