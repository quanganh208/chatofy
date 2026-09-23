import { describe, expect, it, vi } from 'vitest';
import { SpeechGate, type SpeechEndReason, type SpeechGateOptions } from './speech-gate.js';

/**
 * The gate has never had a spec of its own. It was covered only through
 * `CapturePump`, which was enough while its whole job was "end a turn on
 * silence" — but the length ceiling adds a second, independent way for a turn to
 * end, and the interaction between the two is where a mistake hides.
 *
 * Levels here are the gate's own units: it takes an RMS in 0..1 and a duration,
 * and never sees a sample. `SPEECH_MARGIN` is 0.018 over a floor that starts at
 * 0.004, so 0.3 is unambiguously speech and 0 unambiguously silence.
 */
const LOUD = 0.3;
const QUIET = 0;
const BLOCK_MS = 20;

function harness(options: SpeechGateOptions = {}) {
  const events: string[] = [];
  const handlers = {
    onSpeechStart: vi.fn(() => events.push('start')),
    onProbableEnd: vi.fn(() => events.push('probableEnd')),
    onSpeechEnd: vi.fn((reason: SpeechEndReason) => events.push(`end:${reason}`)),
  };
  const gate = new SpeechGate(handlers, options);
  const feed = (rms: number, ms: number) => {
    for (let elapsed = 0; elapsed < ms; elapsed += BLOCK_MS) gate.push(rms, BLOCK_MS);
  };
  return { gate, handlers, events, feed };
}

describe('SpeechGate', () => {
  describe('with no ceiling (the default)', () => {
    it('opens on speech and ends on the hangover', () => {
      const { events, feed } = harness();

      feed(LOUD, 400);
      feed(QUIET, 600);

      expect(events).toEqual(['start', 'probableEnd', 'end:hangover']);
    });

    // The property `apps/web` depends on: nothing about the ceiling may change
    // the sequence a turn produces when the ceiling is off.
    it('never ends a turn on length, however long the speaker goes', () => {
      const { handlers, feed } = harness();

      feed(LOUD, 60_000);

      expect(handlers.onSpeechStart).toHaveBeenCalledTimes(1);
      expect(handlers.onSpeechEnd).not.toHaveBeenCalled();
    });

    it('treats a run shorter than the minimum as room tone', () => {
      const { handlers, feed } = harness();

      feed(LOUD, 60);
      feed(QUIET, 600);

      expect(handlers.onSpeechStart).not.toHaveBeenCalled();
      expect(handlers.onSpeechEnd).not.toHaveBeenCalled();
    });
  });

  describe('with a length ceiling', () => {
    const CEILING: SpeechGateOptions = {
      maxUtteranceMs: 8000,
      cutLookaheadMs: 500,
    };

    // Fed past the ceiling rather than exactly to it: the ceiling bounds the
    // TURN, and the turn does not open until 120ms of speech has confirmed it, so
    // 8000ms of input is a 7900ms turn and correctly does not cut.
    it('cuts a speaker who never pauses, and says the cut was forced', () => {
      const { handlers, events, feed } = harness(CEILING);

      feed(LOUD, 9000);

      expect(events).toContain('end:forced');
      expect(handlers.onSpeechEnd).toHaveBeenCalledWith('forced');
    });

    it('does not cut a turn that is still short of the ceiling', () => {
      const { handlers, feed } = harness(CEILING);

      // 7900ms of turn against an 8000ms ceiling.
      feed(LOUD, 8000);

      expect(handlers.onSpeechEnd).not.toHaveBeenCalled();
    });

    // The whole point of the ceiling: 60s of unbroken speech has to become a
    // sequence of turns rather than one turn that never ends.
    it('turns 60s of unbroken speech into a run of turns near the ceiling', () => {
      const { handlers, feed } = harness(CEILING);

      feed(LOUD, 60_000);

      const turns = handlers.onSpeechEnd.mock.calls.length;
      // 60s at an 8s ceiling. Not exact: the first turn spends 120ms confirming
      // speech before it opens at all.
      expect(turns).toBeGreaterThanOrEqual(7);
      expect(turns).toBeLessThanOrEqual(8);
      expect(handlers.onSpeechStart).toHaveBeenCalledTimes(turns + 1);
    });

    // A hard cut mid-word is the fallback, not the intent.
    it('prefers a pause inside the lookahead over cutting mid-word', () => {
      const { handlers, feed } = harness(CEILING);

      // Reaches the arm mark at 7500ms, then pauses briefly.
      feed(LOUD, 7600);
      feed(QUIET, 100);

      expect(handlers.onSpeechEnd).toHaveBeenCalledTimes(1);
      expect(handlers.onSpeechEnd).toHaveBeenCalledWith('forced');
    });

    // Connected speech dips under the threshold between syllables. A cut on the
    // first quiet block split "I | love" and "differ | ent" in production.
    it('does not cut on a dip too short to be a pause', () => {
      const { handlers, feed } = harness(CEILING);

      feed(LOUD, 7600);
      feed(QUIET, BLOCK_MS * 2);
      feed(LOUD, 200);

      expect(handlers.onSpeechEnd).not.toHaveBeenCalled();
    });

    it('looks for a pause from 1500ms before the ceiling by default', () => {
      const { handlers, feed } = harness({ maxUtteranceMs: 8000 });

      feed(LOUD, 6700);
      feed(QUIET, 100);

      expect(handlers.onSpeechEnd).toHaveBeenCalledWith('forced');
    });

    it('does not cut before the lookahead window opens', () => {
      const { handlers, feed } = harness(CEILING);

      // A pause well before the arm mark must be treated as a pause, not a cut.
      feed(LOUD, 3000);
      feed(QUIET, BLOCK_MS * 2);
      feed(LOUD, 1000);

      expect(handlers.onSpeechEnd).not.toHaveBeenCalled();
    });

    // A forced cut happens while the speaker is still going, so the silence-based
    // onProbableEnd never fires — and without a head start the cut turn pays the
    // full endpoint price. Measured on this repo: ~870ms to first audio when the
    // guess survives, ~1760ms when it does not.
    it('buys the head start once per cut turn, at the arm mark', () => {
      const { handlers, events, feed } = harness(CEILING);

      feed(LOUD, 9000);

      expect(handlers.onProbableEnd).toHaveBeenCalledTimes(1);
      // Before the cut, or the server has nothing to start early on.
      expect(events.indexOf('probableEnd')).toBeLessThan(events.indexOf('end:forced'));
    });

    it('arms each new turn afresh, so every cut turn gets its own head start', () => {
      const { handlers, feed } = harness(CEILING);

      feed(LOUD, 24_000);

      const cuts = handlers.onSpeechEnd.mock.calls.length;
      expect(cuts).toBeGreaterThanOrEqual(2);
      expect(handlers.onProbableEnd.mock.calls.length).toBeGreaterThanOrEqual(cuts);
    });

    // The ceiling counts wall time in the turn, pauses included: a pause delays
    // the listener exactly as much as speech does.
    it('counts pauses towards the ceiling', () => {
      const { handlers, feed } = harness({
        maxUtteranceMs: 2000,
        cutLookaheadMs: 200,
      });

      // 900ms speech, a 300ms pause, then speech again. Speech alone totals
      // 1800ms and would not reach the ceiling; with the pause it does.
      feed(LOUD, 900);
      feed(QUIET, 300);
      feed(LOUD, 900);

      expect(handlers.onSpeechEnd).toHaveBeenCalled();
    });

    it('ends on the hangover rather than the ceiling when the speaker stops first', () => {
      const { handlers, feed } = harness(CEILING);

      feed(LOUD, 1000);
      feed(QUIET, 600);

      expect(handlers.onSpeechEnd).toHaveBeenCalledTimes(1);
      expect(handlers.onSpeechEnd).toHaveBeenCalledWith('hangover');
    });

    describe('resuming after a cut', () => {
      const RESUME: SpeechGateOptions = { ...CEILING, resumeAfterCut: true };

      // Syllables run shorter than the 120ms confirmation. Waiting for one after
      // a cut dropped "comic book" from a replayed recording.
      it('reopens on two speech blocks, without the full confirmation', () => {
        const { events, feed } = harness(RESUME);

        feed(LOUD, 7600);
        feed(QUIET, 100);
        feed(LOUD, BLOCK_MS * 2);

        expect(events.slice(-2)).toEqual(['end:forced', 'start']);
      });

      it('reopens straight away after a cut at the ceiling itself', () => {
        const { handlers, feed } = harness(RESUME);

        feed(LOUD, 8100);
        feed(LOUD, BLOCK_MS * 2);

        expect(handlers.onSpeechEnd).toHaveBeenCalledWith('forced');
        expect(handlers.onSpeechStart).toHaveBeenCalledTimes(2);
      });

      // Once armed, a speaker who really stops is cut too, so the resume window
      // also opens after an ending; a click inside it must not become a turn.
      it('does not reopen on a single loud block', () => {
        const { handlers, feed } = harness(RESUME);

        feed(LOUD, 7600);
        feed(QUIET, 100);
        feed(LOUD, BLOCK_MS);
        feed(QUIET, 200);

        expect(handlers.onSpeechEnd).toHaveBeenCalledWith('forced');
        expect(handlers.onSpeechStart).toHaveBeenCalledTimes(1);
      });

      it('goes back to confirming once the speaker has really stopped', () => {
        const { handlers, feed } = harness(RESUME);

        feed(LOUD, 7600);
        feed(QUIET, 600);
        feed(LOUD, 60);

        expect(handlers.onSpeechStart).toHaveBeenCalledTimes(1);
      });

      it('is off unless asked for', () => {
        const { handlers, feed } = harness(CEILING);

        feed(LOUD, 7600);
        feed(QUIET, 100);
        feed(LOUD, 60);

        expect(handlers.onSpeechStart).toHaveBeenCalledTimes(1);
      });
    });

    it('forgets the ceiling progress when reset mid-turn', () => {
      const { gate, handlers, feed } = harness(CEILING);

      feed(LOUD, 7000);
      gate.reset();
      feed(LOUD, 2000);

      // Had the elapsed time survived the reset, 7000 + 2000 would have cut.
      expect(handlers.onSpeechEnd).not.toHaveBeenCalled();
    });
  });
});
