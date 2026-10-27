import { describe, expect, it, vi } from 'vitest';
import {
  MAX_CONFERENCE_TURN_TEXT_CHARS,
  type ConferenceTranslationSubtitle,
  type LanguageCode,
  type ServerEvent,
} from '@chatofy/types';
import { CascadeSubtitleRelay } from './cascade-subtitle-relay.js';

const S1 = '6f1d2a8e-3b4c-4d5e-8f60-718293a4b5c6';
const S2 = '0a1b2c3d-4e5f-4a6b-9c7d-8e9f0a1b2c3d';

function relay(primary: (sessionId: string) => LanguageCode = () => 'en') {
  const frames: ConferenceTranslationSubtitle[] = [];
  const counts: number[] = [];
  const r = new CascadeSubtitleRelay({
    sourceLanguage: 'vi',
    primary,
    emit: (frame) => frames.push(frame),
    onOpenTurnCountChange: (count) => counts.push(count),
  });
  return { r, frames, counts, finals: () => frames.filter((f) => f.isFinal) };
}

const delta = (sessionId: string, committed: string): ServerEvent => ({
  type: 'server.transcript.delta',
  sessionId,
  committed,
  pending: '',
  reanchors: 0,
  speaker: 'speaker_a',
  languagePair: { source: 'vi', target: 'en' },
});

const translation = (sessionId: string, delta: string, generation = 0): ServerEvent => ({
  type: 'server.translation.delta',
  sessionId,
  delta,
  generation,
  languagePair: { source: 'vi', target: 'en' },
});

const final = (
  sessionId: string,
  sourceText: string,
  translations: Record<string, string>,
): ServerEvent => ({
  type: 'server.transcript.final',
  sessionId,
  segment: {
    id: `seg-${sessionId}`,
    sessionId,
    speakerRole: 'speaker_a',
    sourceLanguages: ['vi'],
    translations,
    sourceText,
    audioUrl: null,
    createdAt: new Date(0).toISOString(),
  },
});

const ended = (sessionId: string, reason = 'completed'): ServerEvent => ({
  type: 'server.session.ended',
  sessionId,
  reason,
});

describe('CascadeSubtitleRelay', () => {
  it('relays the accumulated text of a turn as it grows, keyed by the server session id', () => {
    const h = relay();
    h.r.handle(delta(S1, 'xin chào'));
    h.r.handle(translation(S1, 'hello'));

    expect(h.frames).toEqual([
      {
        sourceLanguage: 'vi',
        targetLanguage: 'en',
        sourceText: 'xin chào',
        translatedText: '',
        translations: { en: '' },
        isFinal: false,
        turnId: S1,
      },
      {
        sourceLanguage: 'vi',
        targetLanguage: 'en',
        sourceText: 'xin chào',
        translatedText: 'hello',
        translations: { en: 'hello' },
        isFinal: false,
        turnId: S1,
      },
    ]);
    expect(h.r.openTurnCount).toBe(1);
  });

  it('does not resend a line that did not change', () => {
    const h = relay();
    h.r.handle(delta(S1, 'xin chào'));
    h.r.handle(delta(S1, 'xin chào'));

    expect(h.frames).toHaveLength(1);
  });

  it('sends exactly one final, with the server text and every translation', () => {
    const h = relay();
    h.r.handle(delta(S1, 'xin chao'));
    h.r.handle(final(S1, 'xin chào bạn', { en: 'hello friend', zh: '你好朋友' }));
    h.r.handle(ended(S1));

    expect(h.finals()).toEqual([
      {
        sourceLanguage: 'vi',
        targetLanguage: 'en',
        sourceText: 'xin chào bạn',
        translatedText: 'hello friend',
        translations: { en: 'hello friend', zh: '你好朋友' },
        isFinal: true,
        turnId: S1,
      },
    ]);
    expect(h.r.openTurnCount).toBe(0);
  });

  it('ignores everything said about a turn after its final', () => {
    const h = relay();
    h.r.handle(final(S1, 'một', { en: 'one' }));
    h.r.handle(delta(S1, 'late'));
    h.r.handle(final(S1, 'again', { en: 'again' }));

    expect(h.frames).toHaveLength(1);
    expect(h.r.openTurnCount).toBe(0);
  });

  it('clears a turn that ended with no final, and never marks it final', () => {
    const h = relay();
    h.r.handle(delta(S1, 'ừm'));
    h.r.handle(ended(S1, 'no_speech'));

    expect(h.finals()).toEqual([]);
    expect(h.frames.at(-1)).toMatchObject({ isFinal: false, sourceText: '', translatedText: '' });
    expect(h.r.openTurnCount).toBe(0);
    expect(h.counts).toEqual([1, 0]);
  });

  it('clears the line on a turn-scoped error but still relays a final that follows', () => {
    const h = relay();
    h.r.handle(delta(S1, 'xin'));
    h.r.handle({ type: 'server.error', code: 'x', message: 'x', sessionId: S1 });
    h.r.handle(final(S1, 'xin chào', { en: 'hello' }));

    expect(h.frames.map((f) => [f.sourceText, f.isFinal])).toEqual([
      ['xin', false],
      ['', false],
      ['xin chào', true],
    ]);
  });

  it('closes open turns with a non-final clear on closeOpen, and forgets them', () => {
    const h = relay();
    h.r.handle(delta(S1, 'một'));
    h.r.handle(delta(S2, 'hai'));

    h.r.closeOpen();
    h.r.handle(final(S1, 'một', { en: 'one' }));

    expect(h.finals()).toEqual([]);
    expect(h.frames.slice(-2).map((f) => [f.turnId, f.sourceText, f.isFinal])).toEqual([
      [S1, '', false],
      [S2, '', false],
    ]);
    expect(h.r.openTurnCount).toBe(0);
  });

  it('keeps two overlapping turns apart', () => {
    const h = relay();
    h.r.handle(delta(S1, 'một'));
    h.r.handle(delta(S2, 'hai'));
    h.r.handle(final(S2, 'hai', { en: 'two' }));

    expect(h.r.openTurnCount).toBe(1);
    expect(h.frames.map((f) => f.turnId)).toEqual([S1, S2, S2]);
  });

  it('clips text to what the room accepts', () => {
    const h = relay();
    const long = 'a'.repeat(MAX_CONFERENCE_TURN_TEXT_CHARS + 50);
    h.r.handle(final(S1, long, { en: long }));

    const [frame] = h.finals();
    expect(frame!.sourceText).toHaveLength(MAX_CONFERENCE_TURN_TEXT_CHARS);
    expect(frame!.translations!.en).toHaveLength(MAX_CONFERENCE_TURN_TEXT_CHARS);
  });

  it('reads the primary language per frame, so a room change applies to the next line', () => {
    let primary: 'en' | 'zh' = 'en';
    const frames: ConferenceTranslationSubtitle[] = [];
    const r = new CascadeSubtitleRelay({
      sourceLanguage: 'vi',
      primary: () => primary,
      emit: (frame) => frames.push(frame),
    });
    r.handle(final(S1, 'một', { en: 'one' }));
    primary = 'zh';
    r.handle(final(S2, 'hai', { zh: '二' }));

    expect(frames.map((f) => [f.targetLanguage, f.translatedText])).toEqual([
      ['en', 'one'],
      ['zh', '二'],
    ]);
  });

  it('does not report a count change for a turn listeners never saw', () => {
    const onOpenTurnCountChange = vi.fn();
    const r = new CascadeSubtitleRelay({
      sourceLanguage: 'vi',
      primary: () => 'en',
      emit: () => {},
      onOpenTurnCountChange,
    });
    r.handle(ended(S1, 'no_speech'));

    expect(onOpenTurnCountChange).not.toHaveBeenCalled();
  });
  describe('a room that changes while a turn is spoken', () => {
    /** A room whose primary is read live; the relay must not follow it mid-turn. */
    const changingRoom = () => {
      let now: LanguageCode = 'en';
      const h = relay(() => now);
      return { ...h, become: (lang: LanguageCode) => (now = lang) };
    };

    it('labels every live frame with the language the turn started in', () => {
      const h = changingRoom();
      h.r.handle(delta(S1, 'xin'));
      h.become('zh');
      h.r.handle(translation(S1, 'hello'));

      expect(h.frames.map((f) => [f.targetLanguage, Object.keys(f.translations ?? {})])).toEqual([
        ['en', ['en']],
        ['en', ['en']],
      ]);
      expect(h.frames.at(-1)!.translations).toEqual({ en: 'hello' });
    });

    it('keeps the turn language on its final and its clear', () => {
      const h = changingRoom();
      h.r.handle(delta(S1, 'xin'));
      h.r.handle(delta(S2, 'hai'));
      h.become('zh');
      h.r.handle(final(S1, 'xin chào', { en: 'hello', zh: '你好' }));
      h.r.handle(ended(S2, 'no_speech'));

      const [finalFrame] = h.finals();
      expect(finalFrame).toMatchObject({ targetLanguage: 'en', translatedText: 'hello' });
      expect(h.frames.at(-1)).toMatchObject({ turnId: S2, targetLanguage: 'en', sourceText: '' });
    });

    it('gives a turn first seen after the change the new language', () => {
      const h = changingRoom();
      h.r.handle(delta(S1, 'xin'));
      h.become('zh');
      h.r.handle(delta(S2, 'hai'));

      expect(h.frames.map((f) => [f.turnId, f.targetLanguage])).toEqual([
        [S1, 'en'],
        [S2, 'zh'],
      ]);
    });
  });
});
