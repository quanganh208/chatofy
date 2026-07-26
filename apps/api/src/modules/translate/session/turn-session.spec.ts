import { MAX_SAMPLE_RATE, type AudioFrame } from '@chatofy/types';
import { TurnSession } from './turn-session';
import { MAX_TURN_SECONDS } from './turn-audio';

const SAMPLE_RATE = 16000;

const frame = (
  session: TurnSession,
  overrides: Partial<AudioFrame> = {},
): AudioFrame => ({
  sessionId: session.sessionId,
  encoding: 'pcm16',
  sampleRate: SAMPLE_RATE,
  sequence: 0,
  timestamp: 0,
  // 100ms of silence — content is irrelevant here.
  payload: Buffer.alloc(SAMPLE_RATE / 10 / 2).toString('base64'),
  ...overrides,
});

const translated = () =>
  Promise.resolve({
    sourceText: 'xin chào',
    targetText: 'hello',
    targetLanguage: 'en' as const,
  });

describe('TurnSession', () => {
  it('opens listening, with no audio and its own id', () => {
    const session = new TurnSession('vi_to_en');

    expect(session.isListening).toBe(true);
    expect(session.isTranslating).toBe(false);
    expect(session.buffered).toBeNull();
    expect(session.sessionId).toEqual(expect.any(String));
    expect(new TurnSession('vi_to_en').sessionId).not.toBe(session.sessionId);
  });

  it('names the speaker from the direction it translates away from', () => {
    expect(new TurnSession('vi_to_en').speakerRole).toBe('speaker_a');
    expect(new TurnSession('en_to_vi').speakerRole).toBe('speaker_b');
  });

  describe('acceptFrame', () => {
    it('takes a well-formed frame and buffers it', () => {
      const session = new TurnSession('vi_to_en');

      expect(session.acceptFrame(frame(session))).toBeNull();
      expect(session.buffered?.byteLength).toBe(800);
      expect(session.buffered?.sampleRate).toBe(SAMPLE_RATE);
    });

    // Messages are asserted in full, not just their codes. They are the wire
    // contract a client reads, and nothing else in this suite pins them: the
    // service spec checks codes, so any of these strings could be reworded
    // without a single test going red.
    it('refuses a frame once the turn is being translated', () => {
      const session = new TurnSession('vi_to_en');
      session.beginTranslating();

      expect(session.acceptFrame(frame(session))).toEqual({
        code: 'session_busy',
        message: 'The turn is already being translated',
      });
    });

    it('refuses a frame belonging to another session', () => {
      const session = new TurnSession('vi_to_en');

      expect(
        session.acceptFrame(frame(session, { sessionId: 'somebody-else' })),
      ).toEqual({
        code: 'frame_rejected',
        message: 'Frame belongs to another session',
      });
    });

    it('refuses an encoding this path cannot decode', () => {
      const session = new TurnSession('vi_to_en');

      expect(session.acceptFrame(frame(session, { encoding: 'opus' }))).toEqual(
        {
          code: 'unsupported_audio',
          message: 'Unsupported frame encoding opus; this path expects pcm16',
        },
      );
    });

    // A sequence that does not advance means a replayed or reordered frame,
    // which would corrupt the utterance.
    it('refuses a sequence that does not advance', () => {
      const session = new TurnSession('vi_to_en');
      session.acceptFrame(frame(session, { sequence: 5 }));

      const repeated = {
        code: 'frame_rejected',
        message: 'Frame sequence did not advance',
      };
      expect(session.acceptFrame(frame(session, { sequence: 5 }))).toEqual(
        repeated,
      );
      expect(session.acceptFrame(frame(session, { sequence: 4 }))).toEqual(
        repeated,
      );
    });

    // Gaps are legitimate: a client gating on voice activity only sends while
    // someone is speaking.
    it('accepts a gap left by voice-activity gating', () => {
      const session = new TurnSession('vi_to_en');
      session.acceptFrame(frame(session, { sequence: 0 }));

      expect(session.acceptFrame(frame(session, { sequence: 40 }))).toBeNull();
    });

    it('refuses a sample rate that changed mid-turn', () => {
      const session = new TurnSession('vi_to_en');
      session.acceptFrame(frame(session, { sequence: 0 }));

      expect(
        session.acceptFrame(frame(session, { sequence: 1, sampleRate: 48000 })),
      ).toEqual({
        code: 'frame_rejected',
        message: `Frame sample rate 48000 differs from the turn's ${SAMPLE_RATE}`,
      });
    });

    it('takes the turn’s rate from whatever the first frame declared', () => {
      const session = new TurnSession('vi_to_en');
      session.acceptFrame(frame(session, { sampleRate: 48000 }));

      expect(session.buffered?.sampleRate).toBe(48000);
    });

    it('ends the turn when the buffer cap is passed', () => {
      const session = new TurnSession('vi_to_en');

      const rejection = session.acceptFrame(
        frame(session, {
          payload: Buffer.alloc(
            MAX_SAMPLE_RATE * 2 * MAX_TURN_SECONDS + 2,
          ).toString('base64'),
        }),
      );

      expect(rejection).toEqual({
        code: 'turn_too_long',
        message: `A turn may not exceed ${MAX_TURN_SECONDS}s of audio`,
        closesTurn: true,
      });
      // The over-long frame is not kept either.
      expect(session.buffered?.isEmpty).toBe(true);
    });

    it('marks only the cap as closing the turn', () => {
      const session = new TurnSession('vi_to_en');

      expect(
        session.acceptFrame(frame(session, { encoding: 'opus' }))?.closesTurn,
      ).toBeUndefined();
    });
  });

  describe('speculation', () => {
    it('will not guess before any audio has arrived', () => {
      expect(new TurnSession('vi_to_en').canSpeculate()).toBe(false);
    });

    it('will not guess on a frame that carried no bytes', () => {
      const session = new TurnSession('vi_to_en');
      session.acceptFrame(frame(session, { payload: '' }));

      expect(session.canSpeculate()).toBe(false);
    });

    it('will not guess twice over identical audio', () => {
      const session = new TurnSession('vi_to_en');
      session.acceptFrame(frame(session));

      expect(session.canSpeculate()).toBe(true);
      session.startSpeculation(session.buffered!.byteLength, translated());
      expect(session.canSpeculate()).toBe(false);
    });

    it('guesses again once the speaker has said more', () => {
      const session = new TurnSession('vi_to_en');
      session.acceptFrame(frame(session, { sequence: 0 }));
      session.startSpeculation(session.buffered!.byteLength, translated());
      session.acceptFrame(frame(session, { sequence: 1 }));

      expect(session.canSpeculate()).toBe(true);
    });

    // Each guess is a metered request, so a client that suspects the end
    // constantly must not be able to spend the quota of one talking normally.
    it('stops guessing once the turn has spent its cap', () => {
      const session = new TurnSession('vi_to_en');

      for (let sequence = 0; sequence < 10; sequence += 1) {
        session.acceptFrame(frame(session, { sequence }));
        if (session.canSpeculate()) {
          session.startSpeculation(session.buffered!.byteLength, translated());
        }
      }

      expect(session.speculationCount).toBe(4);
      expect(session.canSpeculate()).toBe(false);
    });

    it('will not guess while the turn is being translated', () => {
      const session = new TurnSession('vi_to_en');
      session.acceptFrame(frame(session));
      session.beginTranslating();

      expect(session.canSpeculate()).toBe(false);
    });

    it('offers the guess back only while the turn has not grown', () => {
      const session = new TurnSession('vi_to_en');
      session.acceptFrame(frame(session, { sequence: 0 }));
      const work = translated();
      session.startSpeculation(session.buffered!.byteLength, work);

      expect(session.usableSpeculation()).toBe(work);

      session.acceptFrame(frame(session, { sequence: 1 }));
      expect(session.usableSpeculation()).toBeNull();
    });

    it('offers nothing when no guess was ever made', () => {
      const session = new TurnSession('vi_to_en');
      session.acceptFrame(frame(session));

      expect(session.usableSpeculation()).toBeNull();
    });

    // Every guess but the last is discarded unawaited, and an unobserved
    // rejection would take the process down.
    it('observes a rejected guess so the process survives it', async () => {
      const session = new TurnSession('vi_to_en');
      session.acceptFrame(frame(session));
      const unhandled = jest.fn();
      process.on('unhandledRejection', unhandled);

      session.startSpeculation(
        session.buffered!.byteLength,
        Promise.reject(new Error('speculation blew up')),
      );
      // Two turns of the microtask queue plus a macrotask: Node reports an
      // unhandled rejection at the end of the tick it went unobserved in.
      await new Promise((resolve) => setTimeout(resolve, 10));

      process.off('unhandledRejection', unhandled);
      expect(unhandled).not.toHaveBeenCalled();
    });
  });

  describe('outbound sequence', () => {
    it('advances once per frame and never repeats', () => {
      const session = new TurnSession('vi_to_en');

      const sequences = [0, 1, 2, 3].map(() => session.nextOutboundSequence());

      expect(sequences).toEqual([0, 1, 2, 3]);
    });
  });

  describe('toSegment', () => {
    it('carries the turn identity and leaves audio off the record', () => {
      const session = new TurnSession('en_to_vi');

      const segment = session.toSegment('hello', 'xin chào');

      expect(segment).toMatchObject({
        sessionId: session.sessionId,
        speakerRole: 'speaker_b',
        direction: 'en_to_vi',
        sourceText: 'hello',
        targetText: 'xin chào',
        // Audio travels over the socket rather than being stored.
        audioUrl: null,
      });
      expect(segment.id).not.toBe(session.sessionId);
      expect(() => new Date(segment.createdAt).toISOString()).not.toThrow();
    });
  });
});
