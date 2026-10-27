import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LanguageCode } from '@chatofy/types';
import { RelayPlaybackSink } from './relay-playback-sink.js';

/**
 * The far side plays the audio; it does not get to decide when a turn is over.
 */

interface Sent {
  turnKey: string;
  samples: number;
  sampleRate: number;
  lang?: LanguageCode;
}

function sink() {
  const sent: Sent[] = [];
  const drops: string[] = [];
  const sendSilence = vi.fn();
  const onTurnDrained = vi.fn();
  let clock = 0;
  return {
    sent,
    drops,
    sendSilence,
    onTurnDrained,
    advance: (ms: number) => (clock += ms),
    sink: new RelayPlaybackSink({
      sendAudio: (turnKey, samples, sampleRate, lang) =>
        sent.push({ turnKey, samples: samples.length, sampleRate, lang }),
      sendDrop: (turnKey) => drops.push(turnKey),
      sendSilence,
      onTurnDrained,
      now: () => clock,
    }),
  };
}

/** 100ms of audio at 24kHz. */
const chunk = () => new Int16Array(2400);

afterEach(() => {
  vi.useRealTimers();
});

describe('RelayPlaybackSink', () => {
  it('hands each chunk over at once with the turn it belongs to', () => {
    const h = sink();

    h.sink.enqueue('turn-1', chunk(), 24000);

    expect(h.sent).toEqual([{ turnKey: 'turn-1', samples: 2400, sampleRate: 24000 }]);
  });

  it('sends on enqueue rather than pacing the audio', () => {
    const h = sink();

    for (let i = 0; i < 50; i += 1) h.sink.enqueue('turn-1', chunk(), 24000);

    expect(h.sent).toHaveLength(50);
  });

  it('passes the language of each chunk through', () => {
    const h = sink();

    h.sink.enqueue('turn-1', chunk(), 24000, 'en');
    h.sink.enqueue('turn-1', chunk(), 24000, 'zh');

    expect(h.sent.map((s) => s.lang)).toEqual(['en', 'zh']);
  });

  it('counts a turn as playing until its audio has had time to play', () => {
    const h = sink();
    h.sink.enqueue('turn-1', chunk(), 24000);

    expect(h.sink.isPlayingTurn('turn-1')).toBe(true);
    expect(h.sink.isPlaying).toBe(true);
  });

  describe('when a turn stops counting as playing', () => {
    it('is the clock that decides, not the far side', () => {
      // Nothing here takes a report from the far side at all. Letting it retire
      // a turn early releases the next one over the top of the sentence still
      // playing — the interleaving defect this project has already shipped
      // twice, reachable from outside this process.
      const h = sink();
      h.sink.enqueue('turn-1', chunk(), 24000); // 100ms of audio

      expect(h.sink.isPlayingTurn('turn-1')).toBe(true);

      h.advance(100 + 250);

      expect(h.sink.isPlayingTurn('turn-1')).toBe(false);
    });

    it('counts every chunk of a turn, not just the first', () => {
      const h = sink();
      h.sink.enqueue('turn-1', chunk(), 24000);
      h.sink.enqueue('turn-1', chunk(), 24000);
      h.sink.enqueue('turn-1', chunk(), 24000); // 300ms total

      h.advance(200);
      expect(h.sink.isPlayingTurn('turn-1')).toBe(true);

      h.advance(400);
      expect(h.sink.isPlayingTurn('turn-1')).toBe(false);
    });

    it('errs towards still playing rather than releasing the next turn early', () => {
      // The margin covers the far side's start cushion and the relay hop. A turn
      // counted as playing slightly too long costs a moment; the opposite costs
      // two sentences on top of each other.
      const h = sink();
      h.sink.enqueue('turn-1', chunk(), 24000);

      h.advance(100);

      expect(h.sink.isPlayingTurn('turn-1')).toBe(true);
    });

    it('holds a multi-language turn for its longest language, not the sum', () => {
      // Each language plays to different listeners at the same time.
      const h = sink();
      for (let i = 0; i < 3; i += 1) h.sink.enqueue('turn-1', chunk(), 24000, 'en'); // 300ms
      for (let i = 0; i < 5; i += 1) h.sink.enqueue('turn-1', chunk(), 24000, 'zh'); // 500ms

      h.advance(300 + 250);
      expect(h.sink.isPlayingTurn('turn-1')).toBe(true);

      h.advance(200);
      expect(h.sink.isPlayingTurn('turn-1')).toBe(false);
    });

    it('reports the drain itself, because nobody else will', async () => {
      vi.useFakeTimers();
      const sent: string[] = [];
      const onTurnDrained = vi.fn();
      const relay = new RelayPlaybackSink({
        sendAudio: (turnKey) => sent.push(turnKey),
        onTurnDrained,
      });

      relay.enqueue('turn-1', chunk(), 24000);
      await vi.advanceTimersByTimeAsync(300);
      expect(onTurnDrained).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(100);
      expect(onTurnDrained).toHaveBeenCalledWith('turn-1');
    });
  });

  it('tells the far side to drop a turn the pipeline abandoned', () => {
    const h = sink();
    h.sink.enqueue('turn-1', chunk(), 24000);

    h.sink.stopTurn('turn-1');

    expect(h.sink.isPlayingTurn('turn-1')).toBe(false);
    expect(h.drops).toEqual(['turn-1']);
  });

  it('silences everything on teardown', () => {
    const h = sink();
    h.sink.enqueue('turn-1', chunk(), 24000);

    h.sink.stop();

    expect(h.sink.isPlaying).toBe(false);
    expect(h.sendSilence).toHaveBeenCalledTimes(1);
  });

  it('tolerates a caller with nothing to drop or silence', () => {
    const relay = new RelayPlaybackSink({ sendAudio: () => {} });
    relay.enqueue('turn-1', chunk(), 24000);

    expect(() => {
      relay.stopTurn('turn-1');
      relay.stop();
    }).not.toThrow();
  });

  it('does not grow without bound over a long conversation', () => {
    const h = sink();
    for (let i = 0; i < 200; i += 1) h.sink.enqueue(`turn-${i}`, chunk(), 24000);

    expect(h.sink.isPlayingTurn('turn-0')).toBe(false);
    expect(h.sink.isPlayingTurn('turn-199')).toBe(true);
  });
});
