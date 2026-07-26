import { describe, expect, it, vi } from 'vitest';
import { CapturePump } from './capture-pump';
import { TARGET_SAMPLE_RATE } from './pcm-resampler';

/** 20ms blocks, matching what the worklet produces after downsampling. */
const BLOCK_SAMPLES = TARGET_SAMPLE_RATE / 50;
const BLOCK_MS = 20;

/**
 * Sequence number written into sample 0 of every block produced below.
 *
 * Without it each block is byte-identical to its neighbours, so a test can
 * count how many came out but never notice two arriving in the wrong order or
 * one arriving twice. The value is tiny next to the speech amplitude and, over
 * a block this long, moves the RMS of a silent block by ~1e-4 — three orders
 * under the gate's floor, so tagging cannot turn silence into speech.
 */
let nextTag = 0;
const tagOf = (block: Int16Array): number => block[0]!;

/** A block loud enough to read as speech. */
const speech = (): Int16Array => {
  const block = Int16Array.from({ length: BLOCK_SAMPLES }, (_, i) =>
    Math.round(Math.sin(i / 3) * 8000),
  );
  block[0] = ++nextTag;
  return block;
};

/** A block quiet enough to read as silence. */
const silence = (): Int16Array => {
  const block = new Int16Array(BLOCK_SAMPLES);
  block[0] = ++nextTag;
  return block;
};

function harness(options: { fullDuplex?: boolean } = {}) {
  const events: string[] = [];
  const audio: Int16Array[] = [];
  const handlers = {
    onEchoHeard: vi.fn(() => events.push('echo')),
    onTurnOpen: vi.fn((preRoll: Int16Array[]) => {
      events.push(`open:${preRoll.length}`);
      audio.push(...preRoll);
    }),
    onAudio: vi.fn((block: Int16Array) => {
      events.push('audio');
      audio.push(block);
    }),
    onProbableEnd: vi.fn(() => events.push('probableEnd')),
    onTurnClose: vi.fn(() => events.push('close')),
    onLevel: vi.fn(),
  };
  return {
    pump: new CapturePump(handlers, BLOCK_SAMPLES, options.fullDuplex),
    handlers,
    events,
    audio,
  };
}

const push = (pump: CapturePump, block: () => Int16Array, ms: number) => {
  for (let elapsed = 0; elapsed < ms; elapsed += BLOCK_MS) pump.push(block());
};

describe('CapturePump', () => {
  // The defect this test exists for: an earlier revision closed the microphone
  // on speech START, so the gate was reset on every later block and the turn
  // never ended. One block was sent and the app hung, with typecheck, lint and
  // build all green.
  it('completes a turn: open, audio throughout, probable end, close', () => {
    const { pump, events, handlers } = harness();

    push(pump, speech, 1000);
    push(pump, silence, 600);

    expect(handlers.onTurnOpen).toHaveBeenCalledTimes(1);
    expect(handlers.onTurnClose).toHaveBeenCalledTimes(1);
    expect(handlers.onProbableEnd).toHaveBeenCalledTimes(1);
    // Far more than the single block the broken revision managed.
    expect(handlers.onAudio.mock.calls.length).toBeGreaterThan(20);
    expect(events.indexOf('probableEnd')).toBeLessThan(events.indexOf('close'));
    expect(events.at(-1)).toBe('close');
  });

  it('keeps forwarding audio for the whole utterance, not just its first block', () => {
    const { pump, handlers } = harness();

    push(pump, speech, 2000);

    // ~100 blocks of speech; a gate reset mid-turn would truncate this.
    expect(handlers.onAudio.mock.calls.length).toBeGreaterThan(80);
    expect(handlers.onTurnClose).not.toHaveBeenCalled();
  });

  it('suspects the end before declaring it, so the server can start early', () => {
    const { pump, events } = harness();

    push(pump, speech, 500);
    push(pump, silence, 200); // past the probable-end mark, short of the hangover

    expect(events).toContain('probableEnd');
    expect(events).not.toContain('close');
  });

  // The defect this test exists for: silence was streamed on alongside speech,
  // so the byte count the server compares against kept moving after it had
  // been told the turn was probably over. Its check for "nothing arrived
  // since" could therefore never pass, and the early transcription it had
  // already paid for was discarded on every single turn. Nothing failed —
  // the work was simply repeated, and the latency it was meant to save was
  // never saved.
  it('sends nothing once the end is suspected, so the byte count stops moving', () => {
    const { pump, events } = harness();

    push(pump, speech, 500);
    push(pump, silence, 200); // past the probable-end mark, short of the hangover

    const afterProbableEnd = events.slice(events.indexOf('probableEnd'));
    expect(afterProbableEnd).not.toContain('audio');
  });

  it('releases held silence intact when the pause turns out to be mid-utterance', () => {
    const { pump, handlers, audio } = harness();

    push(pump, speech, 400);
    const heldFrom = nextTag + 1;
    push(pump, silence, 300); // long enough to suspect the end, short of it
    push(pump, speech, 200); // they were only drawing breath

    const tags = audio.map(tagOf);

    // Every block, in the order it was captured, exactly once. A lower bound on
    // the count would miss a re-flush sending the backlog twice, and miss the
    // order entirely — both of which corrupt the utterance rather than shorten
    // it, and neither of which a byte count can see.
    expect(tags).toEqual([...tags].sort((a, b) => a - b));
    expect(new Set(tags).size).toBe(tags.length);

    // The pause itself is in there: splicing it out would join two half-words.
    const pauseTags = tags.filter((tag) => tag >= heldFrom);
    expect(pauseTags).toEqual(Array.from({ length: pauseTags.length }, (_, i) => heldFrom + i));
    expect(pauseTags.length).toBeGreaterThan(300 / BLOCK_MS);
    expect(handlers.onTurnClose).not.toHaveBeenCalled();
  });

  // The tail of a word lives below the level that counts as speech. Holding
  // silence to keep the byte count still must not mean the recogniser stops
  // hearing the ends of words.
  it('releases the tail before the end is suspected, not after', () => {
    const { pump, events, audio } = harness();

    push(pump, speech, 500);
    const tailFrom = nextTag + 1;
    push(pump, silence, 300); // past the probable-end mark, short of the hangover

    const deliveredTail = audio.map(tagOf).filter((tag) => tag >= tailFrom);
    expect(deliveredTail.length).toBeGreaterThan(0);
    expect(events).toContain('probableEnd');
  });

  it('opens the turn with the audio captured just beforehand', () => {
    const { pump, handlers } = harness();

    push(pump, silence, 1000); // fills the pre-roll ring
    push(pump, speech, 300);

    const preRoll = handlers.onTurnOpen.mock.calls[0]?.[0] as Int16Array[];
    expect(preRoll.length).toBeGreaterThan(0);
    // Bounded: 320ms of 20ms blocks is 16, never the whole second of silence.
    expect(preRoll.length).toBeLessThanOrEqual(16);
  });

  describe('half-duplex', () => {
    it('ignores the microphone from end of speech until the caller re-arms', () => {
      const { pump, handlers } = harness();
      push(pump, speech, 500);
      push(pump, silence, 600); // closes the turn
      handlers.onAudio.mockClear();
      handlers.onTurnOpen.mockClear();

      // Our own translated speech coming back through the microphone.
      push(pump, speech, 1000);

      expect(pump.isMuted).toBe(true);
      expect(handlers.onTurnOpen).not.toHaveBeenCalled();
      expect(handlers.onAudio).not.toHaveBeenCalled();
    });

    it('starts a fresh turn only after being re-armed', () => {
      const { pump, handlers } = harness();
      push(pump, speech, 500);
      push(pump, silence, 600);
      handlers.onTurnOpen.mockClear();

      pump.armNextTurn();
      expect(pump.isMuted).toBe(false);
      push(pump, speech, 300);

      expect(handlers.onTurnOpen).toHaveBeenCalledTimes(1);
    });

    it('does not carry stale speech state across the muted window', () => {
      // Loudspeaker audio heard while muted must not leave the gate believing
      // someone is mid-utterance, or re-arming would immediately close a turn
      // that never opened.
      const { pump, handlers } = harness();
      push(pump, speech, 500);
      push(pump, silence, 600);
      push(pump, speech, 800); // heard while muted
      handlers.onTurnClose.mockClear();

      pump.armNextTurn();
      push(pump, silence, 800);

      expect(handlers.onTurnClose).not.toHaveBeenCalled();
    });
  });

  it('reports zero level while muted so a meter does not follow our own audio', () => {
    const { pump, handlers } = harness();
    push(pump, speech, 500);
    push(pump, silence, 600);
    handlers.onLevel.mockClear();

    push(pump, speech, 200);

    expect(handlers.onLevel).not.toHaveBeenCalled();
  });

  // Phase 5's measurement. Whether listening through playback is possible comes
  // down to how much of our own audio the microphone hears back, and that has to
  // be countable in the shipping configuration — a microphone that is switched
  // off reports zero echo no matter how bad the echo is.
  describe('echo measurement', () => {
    it('counts our own audio coming back, even while the microphone is ignored', () => {
      const { pump, handlers } = harness();
      push(pump, speech, 500);
      push(pump, silence, 600); // turn closes; playback begins
      // Cleared here: the turn just spoken legitimately forwarded audio, and
      // what this test is about is only what happens after it.
      handlers.onAudio.mockClear();

      push(pump, speech, 400); // the loudspeaker, heard by the microphone

      expect(pump.isMuted).toBe(true);
      expect(handlers.onAudio).not.toHaveBeenCalled();
      expect(handlers.onEchoHeard).toHaveBeenCalled();
    });

    it('reports nothing when playback does not reach the microphone', () => {
      const { pump, handlers } = harness();
      push(pump, speech, 500);
      push(pump, silence, 600);
      handlers.onEchoHeard.mockClear();

      push(pump, silence, 400); // a room that stays quiet through playback

      expect(handlers.onEchoHeard).not.toHaveBeenCalled();
    });

    it('forgets what it heard once the next turn is armed', () => {
      const { pump, handlers } = harness();
      push(pump, speech, 500);
      push(pump, silence, 600);
      push(pump, speech, 400);
      handlers.onEchoHeard.mockClear();

      pump.armNextTurn();
      push(pump, silence, 400);

      expect(handlers.onEchoHeard).not.toHaveBeenCalled();
    });
  });

  // Off by default and meant to stay off until the echo above has been measured
  // on the device that will run the demo.
  describe('full duplex', () => {
    it('keeps listening through playback when switched on', () => {
      const { pump, handlers } = harness({ fullDuplex: true });
      push(pump, speech, 500);
      push(pump, silence, 600); // the turn ends, but the microphone stays open
      handlers.onTurnOpen.mockClear();

      push(pump, speech, 400);

      expect(handlers.onTurnOpen).toHaveBeenCalled();
    });

    it('is off unless asked for', () => {
      const { pump, handlers } = harness();
      push(pump, speech, 500);
      push(pump, silence, 600);
      handlers.onTurnOpen.mockClear();

      push(pump, speech, 400);

      expect(handlers.onTurnOpen).not.toHaveBeenCalled();
    });
  });

  it('treats a brief noise as room tone rather than a turn', () => {
    const { pump, handlers } = harness();

    push(pump, speech, 60); // shorter than the minimum speech run
    push(pump, silence, 600);

    expect(handlers.onTurnOpen).not.toHaveBeenCalled();
    expect(handlers.onTurnClose).not.toHaveBeenCalled();
  });
});
