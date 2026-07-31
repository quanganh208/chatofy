import { describe, expect, it } from 'vitest';
import type { ServerEvent, TranscriptSegment } from '@chatofy/types';
import {
  initialTurnKeyedTranscript,
  liveTurnsInOrder,
  turnKeyedTranscriptReducer,
  type TurnKeyedAction,
  type TurnKeyedTranscript,
} from './turn-keyed-transcript.js';

const segment = (sessionId: string, sourceText: string, targetText: string): TranscriptSegment => ({
  id: `id-${sessionId}`,
  sessionId,
  speakerRole: 'speaker_a',
  direction: 'vi_to_en',
  sourceText,
  targetText,
  audioUrl: null,
  createdAt: '2026-07-30T00:00:00.000Z',
});

const partial = (sessionId: string, text: string): ServerEvent => ({
  type: 'server.transcript.partial',
  sessionId,
  text,
  speaker: 'speaker_a',
  direction: 'vi_to_en',
});

const translationPartial = (sessionId: string, text: string): ServerEvent => ({
  type: 'server.translation.partial',
  sessionId,
  text,
  direction: 'vi_to_en',
});

const final = (sessionId: string, source: string, target: string): ServerEvent => ({
  type: 'server.transcript.final',
  sessionId,
  segment: segment(sessionId, source, target),
});

const ended = (sessionId: string): ServerEvent => ({
  type: 'server.session.ended',
  reason: 'completed',
  sessionId,
});

/** Fold a whole conversation, the way the socket would deliver it. */
const play = (...events: TurnKeyedAction[]): TurnKeyedTranscript =>
  events.reduce(turnKeyedTranscriptReducer, initialTurnKeyedTranscript);

describe('turnKeyedTranscriptReducer', () => {
  it('keeps a separate live line per turn', () => {
    const state = play(partial('a', 'xin chào'), partial('b', 'bạn tên gì'));

    expect(state.live.a?.text).toBe('xin chào');
    expect(state.live.b?.text).toBe('bạn tên gì');
  });

  // The defect that made a second reducer necessary. The single-turn reducer keeps
  // one live line for the conversation and clears it on any turn's final, so the
  // sentence someone is still speaking vanishes off the screen mid-word.
  it('does not clear another turn’s live line when one turn finishes', () => {
    const state = play(
      partial('a', 'xin chào'),
      partial('b', 'tôi đang nói'),
      final('a', 'xin chào', 'hello'),
    );

    expect(state.live.a).toBeUndefined();
    expect(state.live.b?.text).toBe('tôi đang nói');
    expect(state.turns.map((t) => t.sessionId)).toEqual(['a']);
  });

  it('does not clear another turn’s live line when one turn ends without a transcript', () => {
    const state = play(partial('a', 'xin chào'), partial('b', 'tôi đang nói'), ended('a'));

    expect(state.live.a).toBeUndefined();
    expect(state.live.b?.text).toBe('tôi đang nói');
  });

  it('replaces a partial wholesale so a revised word is not left behind', () => {
    const state = play(partial('a', 'xin chao'), partial('a', 'xin chào bạn'));

    expect(state.live.a?.text).toBe('xin chào bạn');
  });

  it('carries text and translation for the same turn side by side', () => {
    const state = play(partial('a', 'xin chào'), translationPartial('a', 'hello'));

    expect(state.live.a).toEqual({ text: 'xin chào', translation: 'hello' });
  });

  it('appends finished turns in the order they finished', () => {
    const state = play(
      final('a', 'một', 'one'),
      final('b', 'hai', 'two'),
      final('c', 'ba', 'three'),
    );

    expect(state.turns.map((t) => t.sourceText)).toEqual(['một', 'hai', 'ba']);
  });

  describe('turns that end without the server saying so', () => {
    // A turn refused at the ceiling, dropped at the backlog ceiling, or released by
    // the stall watchdog produces no `server.session.ended`. Its live line would
    // otherwise sit on screen for the rest of the conversation.
    it('clears the line for an abandoned turn, and only that one', () => {
      const state = play(partial('a', 'bỏ'), partial('b', 'giữ'), {
        type: 'transcript.turnAbandoned',
        sessionId: 'a',
      });

      expect(state.live.a).toBeUndefined();
      expect(state.live.b?.text).toBe('giữ');
    });

    it('ignores an abandonment for a turn with nothing on screen', () => {
      const before = play(partial('b', 'giữ'));
      const after = turnKeyedTranscriptReducer(before, {
        type: 'transcript.turnAbandoned',
        sessionId: 'unknown',
      });

      expect(after).toBe(before);
    });
  });

  describe('errors', () => {
    it('clears the line of the turn that failed', () => {
      const state = play(partial('a', 'lỗi'), partial('b', 'ổn'), {
        type: 'server.error',
        code: 'turn_failed',
        message: 'Translation failed',
        sessionId: 'a',
      });

      expect(state.live.a).toBeUndefined();
      expect(state.live.b?.text).toBe('ổn');
    });

    // A connection-level fault belongs to no turn. Clearing every live line for one
    // would erase sentences from turns that are still perfectly alive.
    it('leaves every line alone for an error that names no turn', () => {
      const before = play(partial('a', 'một'), partial('b', 'hai'));
      const after = turnKeyedTranscriptReducer(before, {
        type: 'server.error',
        code: 'no_active_session',
        message: 'Send client.session.start first',
      });

      expect(after).toBe(before);
      expect(after.live.a?.text).toBe('một');
      expect(after.live.b?.text).toBe('hai');
    });
  });

  it('resets the whole conversation', () => {
    const state = play(partial('a', 'xin chào'), final('b', 'hai', 'two'), {
      type: 'transcript.reset',
    });

    expect(state).toEqual(initialTurnKeyedTranscript);
  });

  it('lists live turns for rendering', () => {
    const state = play(partial('a', 'một'), partial('b', 'hai'));

    expect(liveTurnsInOrder(state)).toEqual([
      { sessionId: 'a', text: 'một', translation: '' },
      { sessionId: 'b', text: 'hai', translation: '' },
    ]);
  });

  it('never mutates the state it was given', () => {
    const before = play(partial('a', 'một'));
    const snapshot = JSON.stringify(before);

    turnKeyedTranscriptReducer(before, partial('b', 'hai'));
    turnKeyedTranscriptReducer(before, final('a', 'một', 'one'));

    expect(JSON.stringify(before)).toBe(snapshot);
  });
});
