import { describe, expect, it } from 'vitest';
import { PartialTranscriptScheduler } from './partial-transcript-scheduler';

/** 16 kHz mono PCM16, the rate the web client captures at. */
const BYTES_PER_SECOND = 32_000;

/** Byte count for `ms` of audio at that rate, so sizes read as durations. */
const bytesFor = (ms: number): number =>
  Math.round((BYTES_PER_SECOND * ms) / 1000);

/** Scheduler with a clock the test drives, so nothing here sleeps. */
function makeScheduler(
  overrides: { cadenceMs?: number; windowSeconds?: number } = {},
) {
  let clock = 1_000;
  const scheduler = new PartialTranscriptScheduler({
    now: () => clock,
    ...overrides,
  });
  return {
    scheduler,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe('PartialTranscriptScheduler', () => {
  describe('when to read', () => {
    it('reads as soon as a turn has audio worth reading', () => {
      const { scheduler } = makeScheduler();
      expect(scheduler.shouldStart(bytesFor(500), BYTES_PER_SECOND)).toBe(true);
    });

    it('does not read a turn that has said nothing yet', () => {
      const { scheduler } = makeScheduler();
      expect(scheduler.shouldStart(0, BYTES_PER_SECOND)).toBe(false);
    });

    // The recogniser does not answer a clip this short with an empty string; it
    // fails outright, and the failure is swallowed on the way back. So the read
    // costs a request per turn and reports itself nowhere the speaker can see.
    // The Vietnamese model measured its refusal at 82ms and below.
    it('does not hand over a clip too short for the recogniser to decode', () => {
      const { scheduler } = makeScheduler();

      expect(scheduler.shouldStart(bytesFor(21), BYTES_PER_SECOND)).toBe(false);
      expect(scheduler.shouldStart(bytesFor(82), BYTES_PER_SECOND)).toBe(false);
    });

    // The floor is a duration, not a byte count: the same bytes are half as much
    // speech at twice the rate, and only the speech is what the model needs.
    it('measures that floor in time rather than in bytes', () => {
      const { scheduler } = makeScheduler();
      const bytes = bytesFor(250);

      expect(scheduler.shouldStart(bytes, BYTES_PER_SECOND)).toBe(true);
      expect(scheduler.shouldStart(bytes, BYTES_PER_SECOND * 2)).toBe(false);
    });

    it('waits out the cadence before reading again', () => {
      const { scheduler, advance } = makeScheduler({ cadenceMs: 300 });
      scheduler.markStarted(bytesFor(500));
      scheduler.markSettled();

      advance(299);
      expect(scheduler.shouldStart(bytesFor(800), BYTES_PER_SECOND)).toBe(
        false,
      );
      advance(1);
      expect(scheduler.shouldStart(bytesFor(800), BYTES_PER_SECOND)).toBe(true);
    });

    // The mechanism that keeps a slow machine from queueing work it cannot do:
    // while a read runs nothing else starts, and once it settles the duty gate
    // — not just the cadence — decides when the next one may.
    it('never starts a second read while one is still running', () => {
      const { scheduler, advance } = makeScheduler({ cadenceMs: 300 });
      scheduler.markStarted(bytesFor(500));

      advance(10_000);
      expect(scheduler.shouldStart(64_000, BYTES_PER_SECOND)).toBe(false);

      scheduler.markSettled();
      // A decode this slow arms the duty gate: the next read waits 3x the
      // decode's own cost (30s here) rather than firing the moment the flag
      // clears, so a slow machine is not handed the same back-to-back load
      // that made it slow.
      expect(scheduler.shouldStart(64_000, BYTES_PER_SECOND)).toBe(false);
      advance(19_999);
      expect(scheduler.shouldStart(64_000, BYTES_PER_SECOND)).toBe(false);
      advance(1); // 30s since the start
      expect(scheduler.shouldStart(64_000, BYTES_PER_SECOND)).toBe(true);
    });

    it('does not spend a read on audio it has already read', () => {
      const { scheduler, advance } = makeScheduler({ cadenceMs: 300 });
      const read = bytesFor(500);
      scheduler.markStarted(read);
      scheduler.markSettled();
      advance(1_000);

      expect(scheduler.shouldStart(read, BYTES_PER_SECOND)).toBe(false);
      expect(scheduler.shouldStart(read + 1, BYTES_PER_SECOND)).toBe(true);
    });

    // The duty gate: a decode that took `d` ms pushes the next start out to
    // `3 * d` ms after the previous START. Without it, a slow machine made the
    // preview path a bigger, not smaller, share of the engine — the in-flight
    // guard only prevents overlap, so a 400ms decode at a 300ms cadence simply
    // ran back-to-back and took the whole lane.
    it('stretches the cadence by the cost of the last decode', () => {
      const { scheduler, advance } = makeScheduler({ cadenceMs: 300 });
      scheduler.markStarted(bytesFor(500));
      advance(400); // the decode itself took 400ms
      scheduler.markSettled();

      // 400ms have passed since the start, past the 300ms floor — but the
      // duty gate wants 3 x 400 = 1200ms.
      expect(scheduler.shouldStart(bytesFor(800), BYTES_PER_SECOND)).toBe(
        false,
      );
      advance(300); // 700ms: still short
      expect(scheduler.shouldStart(bytesFor(800), BYTES_PER_SECOND)).toBe(
        false,
      );
      advance(500); // 1200ms since start: the gate opens
      expect(scheduler.shouldStart(bytesFor(800), BYTES_PER_SECOND)).toBe(true);
    });

    // A cheap decode must not slow a fast machine down: the floor is a floor,
    // and nothing stretches below it.
    it('never stretches the cadence below its floor', () => {
      const { scheduler, advance } = makeScheduler({ cadenceMs: 300 });
      scheduler.markStarted(bytesFor(500));
      advance(50); // a fast decode
      scheduler.markSettled();

      advance(249);
      expect(scheduler.shouldStart(bytesFor(800), BYTES_PER_SECOND)).toBe(
        false,
      );
      advance(1); // 300ms since start, exactly the floor
      expect(scheduler.shouldStart(bytesFor(800), BYTES_PER_SECOND)).toBe(true);
    });
  });

  describe('what to show', () => {
    it('shows a result that covers more of the turn than the last one', () => {
      const { scheduler } = makeScheduler();
      expect(scheduler.shouldEmit(1_600)).toBe(true);
      scheduler.markEmitted(1_600);
      expect(scheduler.shouldEmit(3_200)).toBe(true);
    });

    // Two reads can finish out of order. Showing the older one would rewind the
    // sentence on screen, which reads as the app losing what was just said.
    it('drops a late result that covers less than what is already shown', () => {
      const { scheduler } = makeScheduler();
      scheduler.markEmitted(3_200);

      expect(scheduler.shouldEmit(1_600)).toBe(false);
      expect(scheduler.shouldEmit(3_200)).toBe(false);
    });
  });

  describe('how much audio to read', () => {
    const bytesPerSecond = BYTES_PER_SECOND;

    it('reads the whole turn while it is shorter than the window', () => {
      const { scheduler } = makeScheduler({ windowSeconds: 8 });
      expect(scheduler.windowStart(5 * bytesPerSecond, bytesPerSecond)).toBe(0);
    });

    // Without this the cost of a read grows with the turn, and the gap between
    // updates grows with it — worst on the long turns that need it most.
    it('reads only the newest audio once the turn outgrows the window', () => {
      const { scheduler } = makeScheduler({ windowSeconds: 8 });
      const buffered = 20 * bytesPerSecond;

      const start = scheduler.windowStart(buffered, bytesPerSecond);

      expect(buffered - start).toBe(8 * bytesPerSecond);
    });

    // A cut between the two bytes of a sample shifts every sample after it, and
    // the recogniser is handed noise.
    it('cuts on a whole sample, never between its bytes', () => {
      const { scheduler } = makeScheduler({ windowSeconds: 8 });
      const oddBuffered = 20 * bytesPerSecond + 1;

      expect(scheduler.windowStart(oddBuffered, bytesPerSecond) % 2).toBe(0);
    });
  });
});
