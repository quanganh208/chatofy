import { describe, expect, it } from 'vitest';
import { PagePlaybackSink } from './page-playback-sink';
import type { OutboundCommand } from './outbound-channel';

/**
 * The page schedules the audio; it does not get to decide when a turn is over.
 */

function sink() {
  const sent: OutboundCommand[] = [];
  let clock = 0;
  return {
    sent,
    advance: (ms: number) => (clock += ms),
    sink: new PagePlaybackSink({ send: (command) => sent.push(command), now: () => clock }),
  };
}

/** 100ms of audio at 24kHz. */
const chunk = () => new Int16Array(2400);

describe('PagePlaybackSink', () => {
  it('ships each chunk as base64 with the turn it belongs to', () => {
    const h = sink();

    h.sink.enqueue('turn-1', chunk(), 24000);

    expect(h.sent).toHaveLength(1);
    const [command] = h.sent;
    expect(command).toMatchObject({ type: 'chatofy:audio', turnKey: 'turn-1', sampleRate: 24000 });
    expect(typeof (command as { payload: string }).payload).toBe('string');
  });

  it('counts a turn as playing until its audio has had time to play', () => {
    const h = sink();
    h.sink.enqueue('turn-1', chunk(), 24000);

    expect(h.sink.isPlayingTurn('turn-1')).toBe(true);
    expect(h.sink.isPlaying).toBe(true);
  });

  describe('when a turn stops counting as playing', () => {
    it('is the clock that decides, not the page', () => {
      // Nothing here takes a report from the page at all. Letting the page
      // retire a turn early releases the next one over the top of the sentence
      // still playing — the interleaving defect this project has already
      // shipped twice, reachable from outside the extension.
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
      // The margin covers the queue's start cushion and the relay hop. A turn
      // counted as playing slightly too long costs a moment; the opposite costs
      // two sentences on top of each other.
      const h = sink();
      h.sink.enqueue('turn-1', chunk(), 24000);

      h.advance(100);

      expect(h.sink.isPlayingTurn('turn-1')).toBe(true);
    });
  });

  it('tells the page to drop a turn the pipeline abandoned', () => {
    const h = sink();
    h.sink.enqueue('turn-1', chunk(), 24000);

    h.sink.stopTurn('turn-1');

    expect(h.sink.isPlayingTurn('turn-1')).toBe(false);
    expect(h.sent.at(-1)).toEqual({ type: 'chatofy:drop', turnKey: 'turn-1' });
  });

  it('silences everything on teardown', () => {
    const h = sink();
    h.sink.enqueue('turn-1', chunk(), 24000);

    h.sink.stop();

    expect(h.sink.isPlaying).toBe(false);
    expect(h.sent.at(-1)).toEqual({ type: 'chatofy:silence' });
  });

  it('does not grow without bound over a long conversation', () => {
    const h = sink();
    for (let i = 0; i < 200; i += 1) h.sink.enqueue(`turn-${i}`, chunk(), 24000);

    expect(h.sink.isPlayingTurn('turn-0')).toBe(false);
    expect(h.sink.isPlayingTurn('turn-199')).toBe(true);
  });
});
