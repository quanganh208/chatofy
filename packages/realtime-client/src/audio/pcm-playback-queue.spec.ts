import { describe, expect, it } from 'vitest';
import { PcmPlaybackQueue } from './pcm-playback-queue.js';

/** Just enough of an `AudioContext` to record where and when each chunk plays. */
function fakeContext() {
  const played: Array<{ node: string; at: number; duration: number }> = [];
  const context = {
    currentTime: 0,
    destination: { name: 'speakers' },
    createBuffer: (_channels: number, length: number, sampleRate: number) => ({
      duration: length / sampleRate,
      getChannelData: () => new Float32Array(length),
    }),
    createBufferSource: () => {
      let node = '';
      const source = {
        buffer: null as { duration: number } | null,
        onended: null as (() => void) | null,
        connect: (target: { name: string }) => {
          node = target.name;
        },
        start: (at: number) => played.push({ node, at, duration: source.buffer!.duration }),
        stop: () => {},
        disconnect: () => {},
      };
      return source;
    },
  };
  return { context: context as unknown as AudioContext, played };
}

const second = (rate: number) => new Int16Array(rate);

describe('PcmPlaybackQueue', () => {
  it('plays into one node when given one', () => {
    const { context, played } = fakeContext();
    const queue = new PcmPlaybackQueue(context);
    queue.enqueue('t1', second(16000), 16000, 'en');
    expect(played.map((p) => p.node)).toEqual(['speakers']);
  });

  it('routes each chunk by its language, on one schedule', () => {
    const { context, played } = fakeContext();
    const nodes: Record<string, { name: string }> = {
      vi: { name: 'vi-gain' },
      en: { name: 'en-gain' },
      '': { name: 'untagged' },
    };
    const queue = new PcmPlaybackQueue(
      context,
      () => {},
      (lang) => nodes[lang ?? ''] as unknown as AudioNode,
    );

    queue.enqueue('t1', second(16000), 16000, 'vi');
    queue.enqueue('t2', second(16000), 16000, 'en');
    queue.enqueue('t3', second(16000), 16000);

    expect(played.map((p) => p.node)).toEqual(['vi-gain', 'en-gain', 'untagged']);
    // Back to back, never overlapping, whichever node each lands in.
    expect(played[1]!.at).toBeCloseTo(played[0]!.at + 1);
    expect(played[2]!.at).toBeCloseTo(played[1]!.at + 1);
  });
});
