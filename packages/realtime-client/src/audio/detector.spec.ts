import { describe, expect, it } from 'vitest';
import { RmsDetector, type Detector } from './detector.js';
import { SpeechGate } from './speech-gate.js';

/**
 * The level logic used to live inside `SpeechGate` and was covered only through
 * the gate's own spec. Pulled into `RmsDetector`, it gets tested for what it is:
 * an adaptive floor, in the gate's own units (RMS 0..1, margin 0.018 over a
 * floor that starts at 0.004, so the cold speech edge is ~0.022).
 */
describe('RmsDetector', () => {
  it('calls a clearly loud block speech and a silent one not', () => {
    const d: Detector = new RmsDetector();
    expect(d.detect(0.3, 20)).toBe(true);
    expect(d.detect(0, 20)).toBe(false);
  });

  it('raises its floor on sustained noise until a former speech level is silence', () => {
    const d: Detector = new RmsDetector();
    // 0.025 is speech at the cold floor.
    expect(d.detect(0.025, 20)).toBe(true);

    // Room tone at 0.02 sits under the ~0.022 edge, so it reads as silence and
    // only silence adapts the floor. A long run of it drags the floor up.
    for (let i = 0; i < 2000; i++) d.detect(0.02, 20);

    // The same 0.025 is now under floor + margin: the room got louder and the
    // detector followed it. This is the failure the learned detector targets —
    // in a noisy room the level threshold stops separating speech from tone.
    expect(d.detect(0.025, 20)).toBe(false);
  });

  it('keeps its floor to itself — two detectors do not share state', () => {
    const loud: Detector = new RmsDetector();
    const quiet: Detector = new RmsDetector();

    for (let i = 0; i < 2000; i++) loud.detect(0.02, 20);

    // `quiet` never heard the noise, so its cold floor still calls 0.025 speech;
    // `loud`'s has climbed past it. Two gates (the turn gate and the echo gate)
    // share a capture pump, so their floors must not bleed together.
    expect(quiet.detect(0.025, 20)).toBe(true);
    expect(loud.detect(0.025, 20)).toBe(false);
  });
});

/**
 * The point of the extraction: the gate reads speech from the detector and
 * nowhere else. A detector scripted to a fixed answer, fed a level the RMS
 * detector would never open on, proves the endpoint policy runs on what the
 * detector returns rather than on the level handed to `push`.
 */
describe('SpeechGate delegates detection to its Detector', () => {
  class Scripted implements Detector {
    private i = 0;
    constructor(private readonly answers: boolean[]) {}
    detect(): boolean {
      return this.answers[Math.min(this.i++, this.answers.length - 1)] ?? false;
    }
  }

  it('opens and ends a turn on the detector, at a level the RMS floor would ignore', () => {
    const events: string[] = [];
    // Speech for 400ms (past the 120ms minimum), then 800ms of silence (past the
    // 500ms hangover) — but every block's level is 0. Only the injected detector
    // can be the reason a turn opens and closes here.
    const gate = new SpeechGate(
      {
        onSpeechStart: () => events.push('start'),
        onSpeechEnd: (reason) => events.push(`end:${reason}`),
      },
      {},
      new Scripted([...Array<boolean>(20).fill(true), ...Array<boolean>(40).fill(false)]),
    );

    for (let i = 0; i < 60; i++) gate.push(0, 20);

    expect(events).toContain('start');
    expect(events).toContain('end:hangover');
  });
});
