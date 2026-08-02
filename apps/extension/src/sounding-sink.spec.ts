import { describe, expect, it, vi } from 'vitest';
import { PcmPlaybackQueue } from '@chatofy/realtime-client';
import { SoundingSink } from './sounding-sink';

/**
 * The signal the microphone gate rides on.
 *
 * What matters is that it reports TRANSITIONS. The gate ramps, and a ramp
 * restarted on every 200ms chunk of a turn is a buzz rather than a gate.
 */

/** Enough Web Audio for `PcmPlaybackQueue` to schedule against. */
class FakeContext {
  currentTime = 0;
  readonly destination = {};
  readonly sources: { onended: (() => void) | null }[] = [];

  createBuffer(_channels: number, length: number, sampleRate: number) {
    return { duration: length / sampleRate, getChannelData: () => new Float32Array(length) };
  }

  createBufferSource() {
    const source = {
      buffer: null as unknown,
      onended: null as (() => void) | null,
      connect: () => {},
      start: () => {},
      stop: () => {},
    };
    this.sources.push(source);
    return source;
  }

  /** Every queued chunk finishes, the way the audio clock would report it. */
  finishAll(): void {
    for (const source of [...this.sources]) {
      const ended = source.onended;
      source.onended = null;
      ended?.();
    }
  }
}

const chunk = () => new Int16Array(160);

function sink() {
  const context = new FakeContext();
  const drained = vi.fn();
  const changed = vi.fn();
  const wrapper: { current?: SoundingSink } = {};
  const queue = new PcmPlaybackQueue(context as unknown as AudioContext, (turnKey) => {
    drained(turnKey);
    wrapper.current?.sync();
  });
  wrapper.current = new SoundingSink(queue, changed);
  return { context, drained, changed, sink: wrapper.current };
}

describe('SoundingSink', () => {
  it('announces the start of sound once, not once per chunk', () => {
    const h = sink();

    h.sink.enqueue('turn-1', chunk(), 24000);
    h.sink.enqueue('turn-1', chunk(), 24000);
    h.sink.enqueue('turn-1', chunk(), 24000);

    expect(h.changed.mock.calls).toEqual([[true]]);
  });

  it('announces silence only once the queue has actually drained', async () => {
    vi.useFakeTimers();
    const h = sink();
    h.sink.enqueue('turn-1', chunk(), 24000);
    h.changed.mockClear();

    h.context.finishAll();
    // The queue settles for 60ms before calling a turn drained, so that two
    // halves of one sentence are not reported as its end.
    await vi.advanceTimersByTimeAsync(60);
    vi.useRealTimers();

    expect(h.changed.mock.calls).toEqual([[false]]);
    expect(h.drained).toHaveBeenCalledWith('turn-1');
  });

  it('still sounds while another turn has audio left', () => {
    const h = sink();
    h.sink.enqueue('turn-1', chunk(), 24000);
    h.sink.enqueue('turn-2', chunk(), 24000);
    h.changed.mockClear();

    h.sink.stopTurn('turn-1');

    expect(h.sink.isPlaying).toBe(true);
    expect(h.changed).not.toHaveBeenCalled();
  });

  it('reports silence when the last turn is dropped', () => {
    const h = sink();
    h.sink.enqueue('turn-1', chunk(), 24000);
    h.changed.mockClear();

    h.sink.stopTurn('turn-1');

    expect(h.changed.mock.calls).toEqual([[false]]);
  });

  it('reports silence when everything is stopped at once', () => {
    const h = sink();
    h.sink.enqueue('turn-1', chunk(), 24000);
    h.sink.enqueue('turn-2', chunk(), 24000);
    h.changed.mockClear();

    h.sink.stop();

    expect(h.changed.mock.calls).toEqual([[false]]);
  });
});
