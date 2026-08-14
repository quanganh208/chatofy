import type { TranslationDirection } from '@chatofy/types';
import { TurnTimeline } from './turn-timeline';
import { TurnSession } from './turn-session';
import { TurnAudio } from './turn-audio';

/** A turn whose output voice is beside the point for the behavior under test. */
const openSession = (direction: TranslationDirection = 'vi_to_en') =>
  new TurnSession({ direction, voiceGender: 'female', streaming: false });

/** A clock the test drives, so nothing here has to sleep. */
function fakeClock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

const audioOf = (bytes: number, sampleRate = 16000): TurnAudio => {
  const audio = new TurnAudio(sampleRate);
  audio.append(Buffer.alloc(bytes));
  return audio;
};

describe('TurnTimeline', () => {
  it('measures every stage from the endpoint the client declared', () => {
    const clock = fakeClock();
    const timeline = new TurnTimeline(clock.now);
    const session = openSession();

    clock.advance(400);
    timeline.markSpeculationReused(false);
    timeline.markTranslated('hello there');
    timeline.markClauses(2);
    // One call with the span the audio path measured, which is how the service
    // uses it — the first clause started at +550ms and the last ended at +600ms.
    timeline.markAudio({ firstAudioAt: 1_000_550, lastAudioAt: 1_000_600 });

    const metrics = timeline.toMetrics(session, audioOf(3200), true);

    expect(metrics.translatedAtMs).toBe(400);
    expect(metrics.firstAudioAtMs).toBe(550);
    expect(metrics.lastAudioAtMs).toBe(600);
    expect(metrics.targetChars).toBe('hello there'.length);
    expect(metrics.clauses).toBe(2);
    expect(metrics.completed).toBe(true);
  });

  // A stage that never ran is reported as the time the turn gave up, so every
  // column stays a real elapsed measurement rather than a sentinel.
  it('falls back to the moment the turn gave up when a stage never ran', () => {
    const clock = fakeClock();
    const timeline = new TurnTimeline(clock.now);
    const session = openSession();

    clock.advance(700); // the pipeline threw here; nothing was ever marked

    const metrics = timeline.toMetrics(session, audioOf(3200), false);

    expect(metrics.translatedAtMs).toBe(700);
    expect(metrics.firstAudioAtMs).toBe(700);
    expect(metrics.lastAudioAtMs).toBe(700);
    expect(metrics.completed).toBe(false);
    expect(metrics.targetChars).toBe(0);
    expect(metrics.clauses).toBe(0);
  });

  it('falls back to the translation time when only the audio never came', () => {
    const clock = fakeClock();
    const timeline = new TurnTimeline(clock.now);
    const session = openSession();

    clock.advance(300);
    timeline.markTranslated('hello');
    clock.advance(900); // synthesis failed; no audio was ever pushed

    const metrics = timeline.toMetrics(session, audioOf(3200), false);

    // Not the 1200ms of wall clock: the turn's audio columns report the last
    // stage that actually happened.
    expect(metrics.translatedAtMs).toBe(300);
    expect(metrics.firstAudioAtMs).toBe(300);
    expect(metrics.lastAudioAtMs).toBe(300);
  });

  // Recorded before the pipeline is awaited, so a turn that fails still says
  // whether it was riding a guess.
  it('keeps the speculation verdict even when the turn never finished', () => {
    const clock = fakeClock();
    const timeline = new TurnTimeline(clock.now);
    const session = openSession();

    timeline.markSpeculationReused(true);
    clock.advance(200);

    expect(
      timeline.toMetrics(session, audioOf(3200), false).speculationUsed,
    ).toBe(true);
  });

  it('reads the turn identity and audio it is given', () => {
    const timeline = new TurnTimeline(fakeClock().now);
    const session = openSession('en_to_vi');

    const metrics = timeline.toMetrics(session, audioOf(6400, 48000), true);

    expect(metrics.sessionId).toBe(session.sessionId);
    expect(metrics.direction).toBe('en_to_vi');
    expect(metrics.inputBytes).toBe(6400);
    expect(metrics.inputSampleRate).toBe(48000);
  });

  describe('what the turn spent', () => {
    it('counts the guesses the turn started', () => {
      const timeline = new TurnTimeline(fakeClock().now);
      const session = openSession();
      const work = () =>
        Promise.resolve({
          sourceText: 'a',
          targetText: 'b',
          targetLanguage: 'en' as const,
        });

      session.startSpeculation(100, work());
      session.startSpeculation(200, work());

      expect(
        timeline.toMetrics(session, audioOf(3200), true).speculations,
      ).toBe(2);
    });

    it('counts the provisional translations the turn spent', () => {
      const timeline = new TurnTimeline(fakeClock().now);
      const session = openSession();

      session.liveTranslation.markStarted('hôm qua tôi có đặt phòng');
      session.liveTranslation.markSettled();
      session.liveTranslation.markStarted('hôm qua tôi có đặt phòng hai đêm');

      expect(
        timeline.toMetrics(session, audioOf(3200), true).liveTranslations,
      ).toBe(2);
    });

    it('reports zero for a turn that guessed at nothing', () => {
      const timeline = new TurnTimeline(fakeClock().now);
      const metrics = timeline.toMetrics(openSession(), audioOf(3200), true);

      expect(metrics.speculations).toBe(0);
      expect(metrics.liveTranslations).toBe(0);
    });
  });
});
