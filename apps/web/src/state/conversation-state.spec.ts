import { describe, expect, it } from 'vitest';
import type { ServerEvent, TranscriptSegment } from '@chatofy/types';
import {
  conversationReducer,
  initialConversationState,
  type ConversationState,
} from './conversation-state';

const segment = (sourceText: string, targetText: string): TranscriptSegment => ({
  id: `id-${sourceText}`,
  sessionId: 'session',
  speakerRole: 'speaker_a',
  direction: 'vi_to_en',
  sourceText,
  targetText,
  audioUrl: null,
  createdAt: '2026-07-25T00:00:00.000Z',
});

// Every turn-scoped event now names its turn. This reducer is the deliberately
// single-turn one — it keeps one live line for a whole conversation — so the id
// is carried but never read here. The turn-keyed reducer that does read it lives
// in `@chatofy/realtime-client`.
const partial = (text: string): ServerEvent => ({
  type: 'server.transcript.partial',
  sessionId: 'session',
  text,
  speaker: 'speaker_a',
  direction: 'vi_to_en',
});

const final = (source: string, target: string): ServerEvent => ({
  type: 'server.transcript.final',
  sessionId: 'session',
  segment: segment(source, target),
});

const translationPartial = (text: string): ServerEvent => ({
  type: 'server.translation.partial',
  sessionId: 'session',
  text,
  direction: 'vi_to_en',
});

const ended: ServerEvent = {
  type: 'server.session.ended',
  reason: 'completed',
  sessionId: 'session',
};

/** Fold a whole conversation, the way the socket would deliver it. */
const play = (...events: ServerEvent[]): ConversationState =>
  events.reduce(conversationReducer, initialConversationState);

describe('conversationReducer', () => {
  it('shows the sentence as it is being said', () => {
    const state = play(partial('xin'), partial('xin chào'));

    expect(state.liveText).toBe('xin chào');
    expect(state.turns).toHaveLength(0);
  });

  // The recogniser re-reads the whole utterance each time and may revise a word
  // it had already offered, so a correction must replace the line, not append.
  it('takes a correction rather than growing the line', () => {
    const state = play(partial('tôi muốn đặt bàng'), partial('tôi muốn đặt bàn'));

    expect(state.liveText).toBe('tôi muốn đặt bàn');
  });

  it('replaces the live line with the finished turn', () => {
    const state = play(partial('xin chào'), final('xin chào', 'hello'));

    expect(state.liveText).toBe('');
    expect(state.turns.map((t) => t.targetText)).toEqual(['hello']);
  });

  // The defect this guards: a partial still in flight when the turn was
  // answered would put half the sentence back on screen under its own
  // translation. Order is the whole rule.
  it('does not let a late partial reappear under the finished turn', () => {
    const state = play(partial('xin chào'), final('xin chào', 'hello'), partial('xin ch'), ended);

    expect(state.liveText).toBe('');
    expect(state.turns).toHaveLength(1);
  });

  it('clears a live line the turn never answered', () => {
    const state = play(partial('ưm'), ended);

    expect(state.liveText).toBe('');
    expect(state.turns).toHaveLength(0);
  });

  describe('provisional translation', () => {
    it('shows a translation of the unfinished sentence', () => {
      const state = play(
        partial('hôm qua tôi có đặt phòng'),
        translationPartial('yesterday I booked a room'),
      );

      expect(state.liveTranslation).toBe('yesterday I booked a room');
      expect(state.liveText).toBe('hôm qua tôi có đặt phòng');
    });

    // The sentence is unfinished, so its translation is a guess the rest of the
    // speech can overturn — replaced whole, never appended to.
    it('takes a revision rather than growing', () => {
      const state = play(
        translationPartial('I booked a room'),
        translationPartial('I booked a room but got no confirmation'),
      );

      expect(state.liveTranslation).toBe('I booked a room but got no confirmation');
    });

    it('gives way to the finished translation', () => {
      const state = play(partial('xin chào'), translationPartial('hi'), final('xin chào', 'hello'));

      expect(state.liveTranslation).toBe('');
      expect(state.liveText).toBe('');
      expect(state.turns.map((t) => t.targetText)).toEqual(['hello']);
    });

    // The guess and the answer are the same sentence: leaving the guess under
    // the answer reads as the app contradicting itself.
    it('does not let a late guess reappear beneath the answer', () => {
      const state = play(final('xin chào', 'hello'), translationPartial('hi'), ended);

      expect(state.liveTranslation).toBe('');
      expect(state.turns).toHaveLength(1);
    });

    it('clears a guess the turn never answered', () => {
      const state = play(translationPartial('I think'), ended);

      expect(state.liveTranslation).toBe('');
    });
  });

  it('keeps every turn of a conversation, oldest first', () => {
    const state = play(
      partial('xin chào'),
      final('xin chào', 'hello'),
      partial('cảm ơn'),
      final('cảm ơn', 'thank you'),
    );

    expect(state.turns.map((t) => t.targetText)).toEqual(['hello', 'thank you']);
  });

  it('leaves state untouched by events it does not display', () => {
    const before = play(partial('xin chào'));
    const after = conversationReducer(before, {
      type: 'server.audio.frame',
      frame: {
        sessionId: 'session',
        encoding: 'pcm16',
        sampleRate: 24000,
        sequence: 0,
        timestamp: 0,
        payload: '',
      },
    });

    expect(after).toBe(before);
  });
});
