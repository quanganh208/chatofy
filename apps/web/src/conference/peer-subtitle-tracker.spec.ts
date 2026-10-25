import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConferenceTranslationSubtitle } from '@chatofy/types/events';
import { PeerSubtitleTracker, SUBTITLE_HOLD_MS } from './peer-subtitle-tracker';

const TURN_A = '6f1c6a64-6b0a-4f43-9d5b-0f7f0a8c2a01';
const TURN_B = '6f1c6a64-6b0a-4f43-9d5b-0f7f0a8c2a02';

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
