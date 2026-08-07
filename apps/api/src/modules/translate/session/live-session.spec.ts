import type { RealtimeProvider, StreamHandle } from '@chatofy/ai-providers';
import { LiveSession } from './live-session';
import { MAX_LIVE_SESSION_INPUT_BYTES } from './live-session-limits';

const START = 1_000_000;

/** The provider is only ever held and handed back, so a stub suffices. */
const provider = {} as RealtimeProvider;

const handleOf = (id = 'upstream-1'): StreamHandle => ({
  id,
  close: async () => {},
});

const sessionOf = () =>
  new LiveSession('sess-1', 'vi_to_en', 'vi', START, provider);

describe('LiveSession', () => {
  it('starts with no upstream and idles from the moment it was created', () => {
    const session = sessionOf();

    expect(session.handle).toBeNull();
    expect(session.finished).toBe(false);
    expect(session.lastFrameAt).toBe(START);
  });

  it('stamps how long the dial took when the upstream answers', () => {
    const session = sessionOf();
    const handle = handleOf();

    session.attach(handle, START + 250);

    expect(session.handle).toBe(handle);
    expect(session.lastFrameAt).toBe(START + 250);
    expect(session.toMetricsRow('done', START + 250).upstreamConnectMs).toBe(
      250,
    );
  });

  describe('transcript counters', () => {
    it('counts source characters without flagging the expected language', () => {
      const session = sessionOf();

      session.noteSourceDelta('xin ', 'vi');
      session.noteSourceDelta('chào', 'vi');

      const row = session.toMetricsRow('done', START);
      expect(row.sourceChars).toBe(8);
      expect(row.languageMismatches).toBe(0);
    });

    it('flags a delta detected as anything but the direction source', () => {
      const session = sessionOf();

      session.noteSourceDelta('hello', 'en');
      session.noteSourceDelta('xin chào', 'vi');
      session.noteSourceDelta('there', 'en');

      const row = session.toMetricsRow('done', START);
      expect(row.languageMismatches).toBe(2);
      // Still counted toward the transcript — mismatches are measured, not dropped.
      expect(row.sourceChars).toBe(18);
    });

    it('counts target characters separately from source', () => {
      const session = sessionOf();

      session.noteSourceDelta('xin chào', 'vi');
      session.noteTargetDelta('hello');

      const row = session.toMetricsRow('done', START);
      expect(row.sourceChars).toBe(8);
      expect(row.targetChars).toBe(5);
    });
  });

  describe('translated audio', () => {
    it('stamps time-to-first-byte from the first chunk only', () => {
      const session = sessionOf();

      session.noteTranslatedAudio(new Uint8Array(10), 24000, START + 400);
      session.noteTranslatedAudio(new Uint8Array(10), 24000, START + 900);

      expect(session.toMetricsRow('done', START).firstUpstreamByteMs).toBe(400);
    });

    it('converts accumulated bytes to milliseconds at the rate last seen', () => {
      const session = sessionOf();

      // 24000 samples of 16-bit mono = 48000 bytes = exactly one second.
      session.noteTranslatedAudio(new Uint8Array(24000), 24000, START);
      session.noteTranslatedAudio(new Uint8Array(24000), 24000, START);

      expect(session.toMetricsRow('done', START).outputAudioMs).toBe(1000);
    });

    it('reports zero output milliseconds when no chunk ever arrived', () => {
      const session = sessionOf();

      const row = session.toMetricsRow('idle_timeout', START);
      expect(row.outputAudioMs).toBe(0);
      // Absent rather than zero: nothing came back, which is not the same as
      // something coming back instantly.
      expect(row.firstUpstreamByteMs).toBeUndefined();
    });
  });

  describe('inbound frames', () => {
    it('accumulates bytes and moves the idle clock', () => {
      const session = sessionOf();

      session.noteFrame(320, START + 100);
      session.noteFrame(320, START + 200);

      expect(session.lastFrameAt).toBe(START + 200);
      expect(session.toMetricsRow('done', START).inputBytes).toBe(640);
    });

    it('stays under the ceiling until the ceiling is actually passed', () => {
      const session = sessionOf();

      session.noteFrame(MAX_LIVE_SESSION_INPUT_BYTES, START);
      expect(session.hasExceededInputCeiling()).toBe(false);

      session.noteFrame(1, START);
      expect(session.hasExceededInputCeiling()).toBe(true);
    });
  });

  describe('sequence numbers', () => {
    it('hands out the value before the bump, starting at zero', () => {
      const session = sessionOf();

      expect(session.nextSequence()).toBe(0);
      expect(session.nextSequence()).toBe(1);
      expect(session.nextSequence()).toBe(2);
    });
  });

  describe('finishOnce', () => {
    it('grants the close to exactly one caller', () => {
      const session = sessionOf();

      expect(session.finishOnce()).toBe(true);
      expect(session.finishOnce()).toBe(false);
      expect(session.finishOnce()).toBe(false);
    });

    it('reports itself finished only after the claim', () => {
      const session = sessionOf();

      expect(session.finished).toBe(false);
      session.finishOnce();
      expect(session.finished).toBe(true);
    });
  });

  it('measures duration to the instant the row is written', () => {
    const session = sessionOf();

    const row = session.toMetricsRow('client_stop', START + 12_500);

    expect(row.durationMs).toBe(12_500);
    expect(row.reason).toBe('client_stop');
    expect(row.sessionId).toBe('sess-1');
    expect(row.direction).toBe('vi_to_en');
  });
});
