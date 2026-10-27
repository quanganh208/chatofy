import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConferenceTranslationSubtitle } from '@chatofy/types/events';
import { PeerSubtitleTracker, SUBTITLE_HOLD_MS } from './peer-subtitle-tracker';

const TURN_A = '6f1c6a64-6b0a-4f43-9d5b-0f7f0a8c2a01';
const TURN_B = '6f1c6a64-6b0a-4f43-9d5b-0f7f0a8c2a02';
const TURN_C = '6f1c6a64-6b0a-4f43-9d5b-0f7f0a8c2a03';

function frame(over: Partial<ConferenceTranslationSubtitle> = {}): ConferenceTranslationSubtitle {
  return {
    speakerSocketId: 's-1',
    sourceLanguage: 'vi',
    targetLanguage: 'en',
    sourceText: 'xin chào',
    translatedText: 'hello',
    isFinal: false,
    turnId: TURN_A,
    ...over,
  };
}

function setup() {
  const shown: Record<string, string | undefined> = {};
  const tracker = new PeerSubtitleTracker((socketId, text) => {
    shown[socketId] = text;
  });
  return { tracker, shown };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('PeerSubtitleTracker', () => {
  it('shows the translation to a listener of the other language', () => {
    const { tracker, shown } = setup();
    tracker.receive(frame(), 'en');
    expect(shown['s-1']).toBe('hello');
  });

  it('shows what was said to a listener of the same language', () => {
    const { tracker, shown } = setup();
    tracker.receive(frame(), 'vi');
    expect(shown['s-1']).toBe('xin chào');
  });

  it('replaces the line with each cumulative frame', () => {
    const { tracker, shown } = setup();
    tracker.receive(frame({ translatedText: 'hel' }), 'en');
    tracker.receive(frame({ translatedText: 'hello there' }), 'en');
    expect(shown['s-1']).toBe('hello there');
  });

  it('keeps the previous line rather than blanking for a frame with no translation yet', () => {
    const { tracker, shown } = setup();
    tracker.receive(frame({ translatedText: 'hello', isFinal: true }), 'en');
    tracker.receive(frame({ turnId: TURN_B, sourceText: 'tạm', translatedText: '' }), 'en');
    expect(shown['s-1']).toBe('hello');
  });

  it('clears the line after the hold when the final arrives with no text on this channel', () => {
    const { tracker, shown } = setup();
    tracker.receive(frame({ translatedText: 'uh' }), 'en');
    tracker.receive(frame({ translatedText: '', isFinal: true }), 'en');
    expect(shown['s-1']).toBe('uh');
    vi.advanceTimersByTime(SUBTITLE_HOLD_MS);
    expect(shown['s-1']).toBeUndefined();
  });

  it('clears a finished line after the hold', () => {
    const { tracker, shown } = setup();
    tracker.receive(frame({ isFinal: true }), 'en');
    vi.advanceTimersByTime(SUBTITLE_HOLD_MS);
    expect(shown['s-1']).toBeUndefined();
  });

  it('does not let an earlier turn’s clear wipe a newer line', () => {
    const { tracker, shown } = setup();
    tracker.receive(frame({ isFinal: true }), 'en');
    vi.advanceTimersByTime(SUBTITLE_HOLD_MS - 1000);
    tracker.receive(frame({ turnId: TURN_B, translatedText: 'next line' }), 'en');
    vi.advanceTimersByTime(SUBTITLE_HOLD_MS);
    expect(shown['s-1']).toBe('next line');
  });

  describe('overlapping turns of one speaker', () => {
    it('never goes back to an older turn once a newer one has text', () => {
      const { tracker, shown } = setup();
      tracker.receive(frame({ turnId: TURN_A, translatedText: 'first' }), 'en');
      tracker.receive(frame({ turnId: TURN_B, translatedText: 'second' }), 'en');
      tracker.receive(
        frame({ turnId: TURN_A, translatedText: 'first, done', isFinal: true }),
        'en',
      );
      expect(shown['s-1']).toBe('second');
      tracker.receive(frame({ turnId: TURN_B, translatedText: 'second, more' }), 'en');
      expect(shown['s-1']).toBe('second, more');
      tracker.receive(frame({ turnId: TURN_A, translatedText: 'first, late' }), 'en');
      expect(shown['s-1']).toBe('second, more');
    });

    it('does not let an ignored older final’s hold clear the newer line', () => {
      const { tracker, shown } = setup();
      tracker.receive(frame({ turnId: TURN_A, translatedText: 'first' }), 'en');
      tracker.receive(frame({ turnId: TURN_B, translatedText: 'second' }), 'en');
      tracker.receive(frame({ turnId: TURN_A, translatedText: 'first', isFinal: true }), 'en');
      vi.advanceTimersByTime(SUBTITLE_HOLD_MS * 2);
      expect(shown['s-1']).toBe('second');
    });

    it('shows an older turn’s final while the newer turn has no text yet', () => {
      const { tracker, shown } = setup();
      tracker.receive(frame({ turnId: TURN_A, translatedText: 'first' }), 'en');
      // The next turn has begun, but nothing of it is on this listener's channel.
      tracker.receive(frame({ turnId: TURN_B, sourceText: 'thứ hai', translatedText: '' }), 'en');
      tracker.receive(
        frame({ turnId: TURN_A, translatedText: 'first, done', isFinal: true }),
        'en',
      );
      expect(shown['s-1']).toBe('first, done');
      tracker.receive(frame({ turnId: TURN_B, translatedText: 'second' }), 'en');
      vi.advanceTimersByTime(SUBTITLE_HOLD_MS);
      expect(shown['s-1']).toBe('second');
    });

    it('ranks turns per speaker, so another speaker’s turns do not interfere', () => {
      const { tracker, shown } = setup();
      tracker.receive(frame({ turnId: TURN_A, translatedText: 'mine' }), 'en');
      tracker.receive(
        frame({ speakerSocketId: 's-2', turnId: TURN_B, translatedText: 'theirs' }),
        'en',
      );
      tracker.receive(frame({ turnId: TURN_A, translatedText: 'mine, more' }), 'en');
      expect(shown).toEqual({ 's-1': 'mine, more', 's-2': 'theirs' });
    });
  });

  describe('a turn cleared with no final', () => {
    const clear = (turnId: string) =>
      frame({ turnId, sourceText: '', translatedText: '', isFinal: false });

    it('takes its own line down', () => {
      const { tracker, shown } = setup();
      tracker.receive(frame({ turnId: TURN_A }), 'en');
      tracker.receive(clear(TURN_A), 'en');
      expect(shown['s-1']).toBeUndefined();
    });

    it('leaves a newer turn’s line alone', () => {
      const { tracker, shown } = setup();
      tracker.receive(frame({ turnId: TURN_A, translatedText: 'first' }), 'en');
      tracker.receive(frame({ turnId: TURN_C, translatedText: 'third' }), 'en');
      tracker.receive(clear(TURN_A), 'en');
      expect(shown['s-1']).toBe('third');
    });
  });

  it('ignores a frame with no speaker', () => {
    const { tracker, shown } = setup();
    tracker.receive(frame({ speakerSocketId: undefined }), 'en');
    expect(shown).toEqual({});
  });

  it('cancels pending clears on dispose', () => {
    const { tracker, shown } = setup();
    tracker.receive(frame({ isFinal: true }), 'en');
    tracker.dispose();
    vi.advanceTimersByTime(SUBTITLE_HOLD_MS);
    expect(shown['s-1']).toBe('hello');
  });
});
