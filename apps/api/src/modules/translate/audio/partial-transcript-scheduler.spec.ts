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
      // And the moment it settles the next read may start. At a duty divisor
      // of 1 a decode slower than the floor buys no idle time at all, because
      // the interval runs from the previous START and the decode has already
      // spent it. This is the bound the divisor gave up, asserted rather than
      // left to a comment: a slow machine does get handed back-to-back work.
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
    // `d` ms after the previous START, once `d` passes the floor. Without it, a
    // slow machine made the preview path a bigger, not smaller, share of the
    // engine — the in-flight guard only prevents overlap, so a 700ms decode at
    // a 300ms cadence simply ran back-to-back and took the whole lane.
    //
    // The numbers here are deliberately above the floor. A decode cheaper than
    // 300ms says nothing about the gate, because the floor would answer the
    // same way whatever the divisor is.
    it('stretches the cadence by the cost of the last decode', () => {
      const { scheduler, advance } = makeScheduler({ cadenceMs: 300 });
      scheduler.markStarted(bytesFor(500));
      advance(700); // the decode itself took 700ms
      scheduler.markSettled();

      // 700ms since the start, and the decode cost 700ms: the gate opens
      // exactly here. One millisecond earlier it is shut, which is what pins
      // the divisor to 1 — at 2 this same read would wait until 1400ms.
      expect(scheduler.shouldStart(bytesFor(800), BYTES_PER_SECOND)).toBe(true);
    });

    // The floor is what paces the preview path now, so this is the case that
    // matters: a decode well inside the floor still waits out the rest of it.
    // Measured English costs 289ms at the longest turn the client sends, which
    // is why the floor and not the decode sets the cadence in practice.
    it('paces a sub-floor decode by the floor, measured from the start', () => {
      const { scheduler, advance } = makeScheduler({ cadenceMs: 300 });
      scheduler.markStarted(bytesFor(500));
      advance(289);
      scheduler.markSettled();

      expect(scheduler.shouldStart(bytesFor(800), BYTES_PER_SECOND)).toBe(
        false,
      );
      advance(10); // 299ms since the start
      expect(scheduler.shouldStart(bytesFor(800), BYTES_PER_SECOND)).toBe(
        false,
      );
      advance(1); // 300ms
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
