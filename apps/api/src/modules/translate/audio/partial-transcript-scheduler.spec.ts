import { PartialTranscriptScheduler } from './partial-transcript-scheduler';

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
    it('reads as soon as a turn has audio', () => {
      const { scheduler } = makeScheduler();
      expect(scheduler.shouldStart(1_600)).toBe(true);
    });

    it('does not read a turn that has said nothing yet', () => {
      const { scheduler } = makeScheduler();
      expect(scheduler.shouldStart(0)).toBe(false);
    });

    it('waits out the cadence before reading again', () => {
      const { scheduler, advance } = makeScheduler({ cadenceMs: 300 });
      scheduler.markStarted(1_600);
      scheduler.markSettled();

      advance(299);
      expect(scheduler.shouldStart(3_200)).toBe(false);
      advance(1);
      expect(scheduler.shouldStart(3_200)).toBe(true);
    });

    // The mechanism that keeps a slow machine from queueing work it cannot do:
    // the rate drops to what it can sustain rather than a backlog forming.
    it('never starts a second read while one is still running', () => {
      const { scheduler, advance } = makeScheduler({ cadenceMs: 300 });
      scheduler.markStarted(1_600);

      advance(10_000);
      expect(scheduler.shouldStart(64_000)).toBe(false);

      scheduler.markSettled();
      expect(scheduler.shouldStart(64_000)).toBe(true);
    });

    it('does not spend a read on audio it has already read', () => {
      const { scheduler, advance } = makeScheduler({ cadenceMs: 300 });
      scheduler.markStarted(1_600);
      scheduler.markSettled();
      advance(1_000);

      expect(scheduler.shouldStart(1_600)).toBe(false);
      expect(scheduler.shouldStart(1_601)).toBe(true);
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
    const bytesPerSecond = 32_000; // 16 kHz mono PCM16

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
