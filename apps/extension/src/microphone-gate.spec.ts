import { describe, expect, it } from 'vitest';
import { shouldSuppressMicrophone } from './microphone-gate';

/**
 * The two rules the gate resolves, and the premise one of them rests on.
 *
 * Tested here rather than through `MeetingCapture` because the case that matters
 * most cannot be reached from there at all: what the gate does once the
 * streaming feature is rolled back. That is a compile-time constant in the
 * running extension, so the only honest way to prove the rollback restores the
 * old behaviour is to ask the decision directly.
 */

describe('shouldSuppressMicrophone', () => {
  describe('the echo rule', () => {
    it('shuts the microphone while a translation is audible with gapped playback', () => {
      // The loop this closes: on a loudspeaker the microphone hears the inbound
      // translation, the speech gate opens a turn on it, and the extension
      // translates its own output back into the meeting.
      expect(
        shouldSuppressMicrophone({ audible: true, muted: false, continuousPlayback: false }),
      ).toBe(true);
    });

    it('opens it again once nothing is sounding', () => {
      expect(
        shouldSuppressMicrophone({ audible: false, muted: false, continuousPlayback: false }),
      ).toBe(false);
    });

    /** The premise, stated as a test. Why it matters: `microphone-gate.ts`. */
    it('does NOT shut it on audible playback when playback is continuous', () => {
      expect(
        shouldSuppressMicrophone({ audible: true, muted: false, continuousPlayback: true }),
      ).toBe(false);
    });
  });

  describe('the privacy rule', () => {
    it('shuts the microphone when the meeting client muted us, whatever the backend', () => {
      // Not a mode setting and not part of the headphones trade. Speech the user
      // believes is private must never be captured, translated, or handed to the
      // page, under any backend.
      expect(
        shouldSuppressMicrophone({ audible: false, muted: true, continuousPlayback: true }),
      ).toBe(true);
      expect(
        shouldSuppressMicrophone({ audible: false, muted: true, continuousPlayback: false }),
      ).toBe(true);
    });

    it('outranks the exemption even while a translation is sounding', () => {
      expect(
        shouldSuppressMicrophone({ audible: true, muted: true, continuousPlayback: true }),
      ).toBe(true);
    });
  });

  describe('rolling the streaming feature back', () => {
    it('restores the old gate exactly', () => {
      // `CASCADE_STREAMING = false` is documented as the rollback for the whole
      // feature. That promise includes the gate: the old backend coming back
      // with the exemption still in place would leave the echo loop open in the
      // one mode that has gaps for it to matter in.
      const gapped = (audible: boolean, muted: boolean) =>
        shouldSuppressMicrophone({ audible, muted, continuousPlayback: false });

      expect(gapped(true, false)).toBe(true);
      expect(gapped(false, false)).toBe(false);
      expect(gapped(false, true)).toBe(true);
    });
  });
});
