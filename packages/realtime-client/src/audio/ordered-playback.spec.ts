import { afterEach, describe, expect, it, vi } from 'vitest';
import { OrderedPlayback, type PlaybackSink } from './ordered-playback.js';

/**
 * A queue that records what reached it, and lets a test say when a turn's audio
 * has finished sounding.
 *
 * Both halves matter. The order chunks arrive in is the thing under test, and
 * `isPlayingTurn` is what separates "turn A finished" from "turn A starved between
 * two clauses" — a distinction that is impossible to provoke reliably out of the
 * real Web Audio clock and trivial to state here.
 */
class RecordingQueue implements PlaybackSink {
  /** `${turnKey}:${tag}` for every chunk, in the order it was enqueued. */
  readonly enqueued: string[] = [];
  readonly stoppedTurns: string[] = [];
  stopped = 0;
  /** Turns the test says are currently sounding. */
  private readonly sounding = new Set<string>();

  enqueue(turnKey: string, samples: Int16Array): void {
    this.enqueued.push(`${turnKey}:${samples[0]}`);
    this.sounding.add(turnKey);
  }

  isPlayingTurn(turnKey: string): boolean {
    return this.sounding.has(turnKey);
  }

  get isPlaying(): boolean {
    return this.sounding.size > 0;
  }

  stop(): void {
    this.stopped += 1;
    this.sounding.clear();
  }

  stopTurn(turnKey: string): void {
    this.stoppedTurns.push(turnKey);
    this.sounding.delete(turnKey);
  }

  /** The turn's queued audio has played out. */
  finishSounding(turnKey: string): void {
    this.sounding.delete(turnKey);
  }

  /** Only the turn keys, for assertions that do not care which chunk. */
  get turnOrder(): string[] {
    return this.enqueued.map((entry) => entry.split(':')[0]!);
  }
}

/** One chunk, tagged in sample 0 so a test can name it. */
const chunk = (tag: number): Int16Array => {
  const samples = new Int16Array(1600); // 100ms at 16 kHz
  samples[0] = tag;
  return samples;
};

function harness() {
  const queue = new RecordingQueue();
  const dropped: { turnKey: string; reason: string }[] = [];
  const logs: string[] = [];
  const playing: boolean[] = [];
  const playback = new OrderedPlayback(queue, {
    onDropped: (turnKey, reason) => dropped.push({ turnKey, reason }),
    onLog: (message) => logs.push(message),
    onPlayingChanged: (value) => playing.push(value),
  });
  const push = (turnKey: string, tag: number) => playback.push(turnKey, chunk(tag), 16000);
  /** The turn's audio played out and the queue said so. */
  const drain = (turnKey: string) => {
    queue.finishSounding(turnKey);
    playback.onTurnDrained(turnKey);
  };
  return { playback, queue, dropped, logs, playing, push, drain };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('OrderedPlayback', () => {
  // The defect this class exists for. Turn A runs 8s, turn B starts after it and
  // runs 2s, so B comes back first and a queue that schedules by arrival plays
  // the second sentence before the first. Both are intact; every gate is green.
  it('plays the turn that was spoken first, even when the later one returns first', () => {
    const h = harness();

    h.playback.open('A');
    h.playback.open('B');
    // B is quicker through the pipeline and its audio lands first.
    h.push('B', 1);
    h.push('A', 2);
    h.playback.finish('A');
    h.playback.finish('B');

    // B is still held: A has ended but is mid-sentence in someone's ear.
    expect(h.queue.enqueued).toEqual(['A:2']);

    h.drain('A');
    expect(h.queue.enqueued).toEqual(['A:2', 'B:1']);
  });

  it('keeps a whole turn together rather than interleaving two', () => {
    const h = harness();

    h.playback.open('A');
    h.playback.open('B');
    h.push('B', 1);
    h.push('A', 2);
    h.push('B', 3);
    h.push('A', 4);
    h.playback.finish('B');
    h.playback.finish('A');
    h.drain('A');

    expect(h.queue.enqueued).toEqual(['A:2', 'A:4', 'B:1', 'B:3']);
  });

  // The starvation case, and the reason chunks carry a turn token at all. Once
  // several turns share the sidecars, a clause can finish playing before the next
  // one is synthesized — the measurement that said otherwise was taken with a
  // single turn in flight. A queue-level "empty" read as "turn A is done" releases
  // B and then plays the rest of A behind it.
  it('does not release the next turn when the current one merely starved', () => {
    const h = harness();

    h.playback.open('A');
    h.playback.open('B');
    h.push('A', 1); // A's first clause plays
    h.push('B', 2); // B is ready and waiting
    h.drain('A'); // A ran dry, but the server has NOT closed it

    expect(h.queue.turnOrder).toEqual(['A']);

    h.push('A', 3); // A's second clause finally arrives
    expect(h.queue.enqueued).toEqual(['A:1', 'A:3']);

    // Only now, with A actually closed and played out, may B be heard.
    h.playback.finish('A');
    h.drain('A');
    expect(h.queue.enqueued).toEqual(['A:1', 'A:3', 'B:2']);
  });

  describe('turns that end without audio must still release the queue', () => {
    it('releases the next turn when one ends carrying no audio at all', () => {
      const h = harness();

      h.playback.open('A');
      h.playback.open('B');
      h.push('B', 1);
      h.playback.finish('A'); // no_audio: nothing was ever pushed for A

      expect(h.queue.enqueued).toEqual(['B:1']);
    });

    it('releases the next turn when one fails', () => {
      const h = harness();

      h.playback.open('A');
      h.playback.open('B');
      h.push('B', 1);
      h.playback.finish('A'); // a turn-level error is reported the same way

      expect(h.queue.enqueued).toEqual(['B:1']);
    });

    // The path most easily forgotten, and the one that jams the queue forever.
    // A turn refused at the concurrency ceiling never gets a session id, so the
    // client's own turn id is the only name it has.
    it('releases the queue for a turn refused before it ever opened server-side', () => {
      const h = harness();

      h.playback.open('turn-1');
      h.playback.open('turn-2');
      h.push('turn-2', 1);

      // too_many_turns, identified only by turnId.
      h.playback.finish('turn-1');

      expect(h.queue.enqueued).toEqual(['turn-2:1']);
    });

    it('retires a whole run of empty turns in one go', () => {
      const h = harness();

      for (const key of ['A', 'B', 'C', 'D']) h.playback.open(key);
      h.push('D', 1);
      h.playback.finish('A');
      h.playback.finish('B');
      h.playback.finish('C');

      // Three refusals in a row must not advance the queue one event at a time.
      expect(h.queue.enqueued).toEqual(['D:1']);
      expect(h.playback.heldTurns).toBe(1);
    });
  });

  describe('stall watchdog', () => {
    // A stuck turn is a hang rather than a wrong answer, so nothing throws and the
    // app simply goes quiet. Every signal that would complete a turn travels over
    // a socket that can drop one.
    it('releases a head that never ends, and says so', () => {
      vi.useFakeTimers();
      const h = harness();

      h.playback.open('A');
      h.playback.open('B');
      h.push('A', 1);
      h.push('B', 2);
      h.drain('A'); // A played out but the server never closed it

      vi.advanceTimersByTime(15_000);

      expect(h.dropped).toEqual([{ turnKey: 'A', reason: 'stalled' }]);
      expect(h.logs.join(' ')).toContain('stalled');
      // And B is heard rather than lost with it.
      expect(h.queue.enqueued).toEqual(['A:1', 'B:2']);
    });

    it('does not fire while the head is progressing normally', () => {
      vi.useFakeTimers();
      const h = harness();

      h.playback.open('A');
      h.push('A', 1);
      h.playback.finish('A');
      h.drain('A');

      vi.advanceTimersByTime(60_000);

      expect(h.dropped).toEqual([]);
    });
  });

  describe('backlog ceiling', () => {
    // "No sentence is lost" is bounded, not absolute. What matters is that the
    // bound is counted rather than silent.
    it('drops the oldest waiting turn and reports it', () => {
      const h = harness();

      h.playback.open('head');
      h.push('head', 0);
      // Head is sounding and never ends, so everything else piles up behind it.
      for (let i = 1; i <= 8; i += 1) {
        h.playback.open(`t${i}`);
        // 20 chunks of 100ms each: 2s of audio per turn.
        for (let c = 0; c < 20; c += 1) h.push(`t${i}`, i * 100 + c);
      }

      expect(h.dropped.length).toBeGreaterThan(0);
      expect(h.dropped.every((d) => d.reason === 'backlog')).toBe(true);
      // Oldest first — the decision is to stay close to real time, because what
      // was said three seconds ago has already lost its value.
      expect(h.dropped[0]?.turnKey).toBe('t1');
      // Never silent.
      expect(h.logs.some((line) => line.includes('backlog'))).toBe(true);
    });

    // Cutting off the sentence currently in someone's ear is worse than any
    // backlog, and the head is the watchdog's responsibility in any case.
    it('never drops the turn that is currently playing', () => {
      const h = harness();

      h.playback.open('head');
      h.push('head', 0);
      for (let i = 1; i <= 8; i += 1) {
        h.playback.open(`t${i}`);
        for (let c = 0; c < 20; c += 1) h.push(`t${i}`, i * 100 + c);
      }

      expect(h.dropped.some((d) => d.turnKey === 'head')).toBe(false);
      expect(h.queue.stoppedTurns).not.toContain('head');
    });

    it('discards audio arriving for a turn that was dropped', () => {
      const h = harness();

      h.playback.open('A');
      h.playback.open('B');
      h.push('B', 1);
      h.playback.drop('B', 'backlog');
      h.push('B', 2); // late frame for a turn nobody is waiting for

      h.playback.finish('A');

      expect(h.queue.turnOrder).not.toContain('B');
    });
  });

  describe('busy reporting', () => {
    // Ducking hangs off this. If it stayed true while the backlog grew, the
    // original speech would be ducked for the whole meeting.
    it('reports idle again once everything has played out', () => {
      const h = harness();

      h.playback.open('A');
      h.push('A', 1);
      h.playback.finish('A');
      h.drain('A');

      expect(h.playback.isBusy).toBe(false);
      expect(h.playing.at(-1)).toBe(false);
    });

    it('is busy while a turn is still waiting behind the head', () => {
      const h = harness();

      h.playback.open('A');
      h.playback.open('B');
      h.push('A', 1);
      h.push('B', 2);

      expect(h.playback.isBusy).toBe(true);
      expect(h.playback.backlogMs).toBeGreaterThan(0);
    });

    it('forgets everything on stop', () => {
      const h = harness();

      h.playback.open('A');
      h.push('A', 1);
      h.playback.stop();

      expect(h.queue.stopped).toBe(1);
      expect(h.playback.heldTurns).toBe(0);
      expect(h.playback.isBusy).toBe(false);
    });
  });
});
