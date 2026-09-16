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

const delta = (sessionId: string, committed: string, pending = '', reanchors = 0): ServerEvent => ({
  type: 'server.transcript.delta',
  sessionId,
  committed,
  pending,
  reanchors,
  speaker: 'speaker_a',
  direction: 'vi_to_en',
});

const translationDelta = (sessionId: string, delta: string, generation = 0): ServerEvent => ({
  type: 'server.translation.delta',
  sessionId,
  delta,
  generation,
  direction: 'vi_to_en',
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

const final = (
  sessionId: string,
  source: string,
  target: string,
  display?: string,
): ServerEvent => ({
  type: 'server.transcript.final',
  sessionId,
  segment: segment(sessionId, source, target),
  ...(display === undefined ? {} : { display }),
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

  /**
   * Ported from `apps/web/src/state/conversation-state.spec.ts`, which this
   * reducer replaced on the web page. The single-turn reducer had no explicit
   * guard against a late partial either — the guarantee comes from the turn's
   * `ended` arriving after it, which is what these two assert end to end.
   */
  it('does not let a late partial reappear under the finished turn', () => {
    const state = play(
      partial('a', 'xin chào'),
      final('a', 'xin chào', 'hello'),
      partial('a', 'xin ch'),
      ended('a'),
    );

    expect(state.live.a).toBeUndefined();
    expect(state.turns).toHaveLength(1);
  });

  it('does not let a late guess reappear beneath the answer', () => {
    const state = play(
      translationPartial('a', 'hell'),
      final('a', 'xin chào', 'hello'),
      translationPartial('a', 'hell'),
      ended('a'),
    );

    expect(state.live.a).toBeUndefined();
    expect(state.turns).toHaveLength(1);
  });

  it('clears a live line the turn never answered', () => {
    const state = play(partial('a', 'ưm'), ended('a'));

    expect(state.live.a).toBeUndefined();
    expect(state.turns).toHaveLength(0);
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

    it('records a turn whose audio was dropped, so the transcript can say so', () => {
      // The case the marker exists for: the text landed, the audio waited behind
      // a backlog past its ceiling, and the turn was dropped rather than
      // delayed. Nothing on screen distinguished it from a turn that played.
      const state = play(final('a', 'xin chào', 'hello'), {
        type: 'transcript.turnAbandoned',
        sessionId: 'a',
        reason: 'backlog',
      });

      expect(state.unheard.a).toBe('backlog');
      // The turn itself is untouched — what was lost is the audio, not the text.
      expect(state.turns.map((turn) => turn.sessionId)).toEqual(['a']);
    });

    it('marks a turn dropped while still holding captured audio', () => {
      // `dropped_pending` is the pipeline's own ceiling: the turn never reached
      // the server, so no `server.session.ended` will ever come. It was
      // carrying a whole captured utterance when it went, which is the heaviest
      // loss this transcript can record — before the reason was listed, the
      // reducer discarded it and the sentence vanished without a marker.
      const state = play(partial('a', 'bỏ'), {
        type: 'transcript.turnAbandoned',
        sessionId: 'a',
        reason: 'dropped_pending',
      });

      expect(state.unheard.a).toBe('dropped_pending');
      expect(state.live.a).toBeUndefined();
    });

    it('leaves reasons that never had audio unmarked', () => {
      // A turn refused at the ceiling was never translated, so "not spoken" would
      // be describing something that never existed.
      const state = play(final('a', 'xin chào', 'hello'), {
        type: 'transcript.turnAbandoned',
        sessionId: 'a',
        reason: 'too_many_turns',
      });

      expect(state.unheard).toEqual({});
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

  /**
   * The continuous backend's text. It names no turn, arrives as a fragment, and
   * nothing ever ends the line — so all three of the turn path's assumptions are
   * inverted here, which is why it has its own action rather than borrowing
   * `server.transcript.partial`.
   */
  describe('continuous-mode text', () => {
    const delta = (channel: 'source' | 'target', text: string): TurnKeyedAction => ({
      type: 'transcript.liveDelta',
      sessionId: 'live:vi_to_en',
      channel,
      delta: text,
    });

    it('APPENDS deltas rather than replacing, unlike a turn partial', () => {
      // The turn path rewrites wholesale because the recogniser re-reads the
      // utterance. Here the text already delivered is final, so treating a
      // fragment as a whole line would leave only the last few words on screen.
      const state = play(delta('source', 'xin '), delta('source', 'chào '), delta('source', 'bạn'));

      expect(state.live['live:vi_to_en']!.text).toBe('xin chào bạn');
    });

    it('keeps the two channels apart', () => {
      const state = play(delta('source', 'xin chào'), delta('target', 'hello'));

      expect(state.live['live:vi_to_en']).toEqual({ text: 'xin chào', translation: 'hello' });
    });

    it('caps a line at 600 characters, keeping the TAIL', () => {
      // Nothing on this path ever ends a line, so an hour-long meeting is one
      // string that grows for its whole length and re-renders in full on every
      // fragment. The tail is what someone is still reading.
      const state = play(delta('source', 'a'.repeat(400)), delta('source', 'b'.repeat(300)));
      const line = state.live['live:vi_to_en']!.text;

      // 700 characters in, 600 out: the oldest 100 are the ones dropped.
      expect(line).toBe('a'.repeat(300) + 'b'.repeat(300));
    });

    it('leaves turn-based lines on other keys untouched', () => {
      const state = play(partial('a', 'một'), delta('source', 'hai'));

      expect(state.live.a!.text).toBe('một');
      expect(state.live['live:vi_to_en']!.text).toBe('hai');
    });
  });

  describe('typeset display text', () => {
    it('lands with its turn in ONE update, so the line never visibly changes', () => {
      // The whole reason the rendering rides on `transcript.final`. As its own
      // event it was a second frame and a second macrotask, and React batches
      // within a task rather than across them — so the words-form painted once
      // before being replaced.
      const state = play(
        final('a', 'ghi nhận lúc mười bảy giờ', 'recorded at 5pm', 'ghi nhận lúc 17:00'),
      );

      expect(state.turns).toHaveLength(1);
      expect(state.displays.a).toBe('ghi nhận lúc 17:00');
    });

    it('records NO entry when the server sent no display', () => {
      // Presence is the client's signal that a line differs from what the
      // recognizer produced, and it decides whether a "show original"
      // disclosure appears. An entry for an unchanged line would put that
      // disclosure under every turn in the conversation.
      const state = play(final('a', 'tôi sinh ra ở đà nẵng', 'i was born in da nang'));

      expect(state.displays.a).toBeUndefined();
    });

    it('keeps the persisted record raw when a display rides along', () => {
      const state = play(
        final('a', 'ghi nhận lúc mười bảy giờ', 'recorded at 5pm', 'ghi nhận lúc 17:00'),
      );

      expect(state.turns[0]!.sourceText).toBe('ghi nhận lúc mười bảy giờ');
    });
  });

  describe('the legacy display event', () => {
    const display = (sessionId: string, text: string): ServerEvent => ({
      type: 'server.transcript.display',
      sessionId,
      text,
    });

    it('keeps a repair beside the turn instead of inside it', () => {
      const state = play(
        final('a', 'ghi nhận lúc mười bảy giờ', 'recorded at 5pm'),
        display('a', 'Ghi nhận lúc 17:00.'),
      );

      expect(state.displays.a).toBe('Ghi nhận lúc 17:00.');
      // `sourceText` is the persisted record of what the recognizer produced and
      // is the only thing any metric reads. A repaired string written over it
      // would carry ITN'd text into the WER path and make the transcript stop
      // being evidence about the local engine.
      expect(state.turns[0]!.sourceText).toBe('ghi nhận lúc mười bảy giờ');
    });

    it('accepts a repair that arrives before its turn does', () => {
      // The server sends this only after the final, but the reducer does not
      // depend on that: rendering reads `displays[sessionId]` per turn, so an
      // entry with no turn is simply never looked at. Refusing it here would
      // instead lose a repair to an ordering nothing actually guarantees.
      const state = play(display('a', 'Ghi nhận lúc 17:00.'), final('a', 'ghi nhận', 'recorded'));

      expect(state.displays.a).toBe('Ghi nhận lúc 17:00.');
      expect(state.turns).toHaveLength(1);
    });

    it('leaves every other turn alone', () => {
      const state = play(final('a', 'một', 'one'), final('b', 'hai', 'two'), display('b', 'Hai.'));

      expect(state.displays).toEqual({ b: 'Hai.' });
    });

    it('drops repairs when a new conversation starts', () => {
      const state = play(final('a', 'một', 'one'), display('a', 'Một.'), {
        type: 'transcript.reset',
      });

      expect(state.displays).toEqual({});
    });
  });

  it('never mutates the state it was given', () => {
    const before = play(partial('a', 'một'));
    const snapshot = JSON.stringify(before);

    turnKeyedTranscriptReducer(before, partial('b', 'hai'));
    turnKeyedTranscriptReducer(before, final('a', 'một', 'one'));

    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe('settled transcript text', () => {
  const run = (events: TurnKeyedAction[]): TurnKeyedTranscript =>
    events.reduce(turnKeyedTranscriptReducer, initialTurnKeyedTranscript);

  it('renders the newest delta rather than joining it to the last one', () => {
    const state = run([delta('s1', 'xin', ' chào'), delta('s1', 'xin chào', ' các bạn')]);
    expect(state.live.s1?.text).toBe('xin chào các bạn');
    expect(state.live.s1?.committedChars).toBe(8);
  });

  it('replaces pending text instead of accumulating it', () => {
    const state = run([delta('s1', 'a', 'bc'), delta('s1', 'a', 'xy')]);
    expect(state.live.s1?.text).toBe('axy');
    expect(state.live.s1?.text).not.toContain('bc');
  });

  it('keeps settled text when a partial lands between two deltas', () => {
    // The defect this whole event exists to prevent: a partial rewrites the
    // line without touching the index into it, so the settled span would start
    // describing different characters.
    const state = run([
      delta('s1', 'xin chào'),
      partial('s1', 'xin chào cắc'),
      delta('s1', 'xin chào', ' các bạn'),
    ]);
    expect(state.live.s1?.text.slice(0, 8)).toBe('xin chào');
  });

  it('ignores a partial once the turn has settled text', () => {
    // The measured race: on the one read where a disagreement has appeared and
    // not yet been confirmed, the newest guess no longer starts with the settled
    // text, so letting it through would visibly rewrite the settled span.
    const state = run([delta('s1', 'xin chào', ' các'), partial('s1', 'chào bạn ơi')]);
    expect(state.live.s1?.text).toBe('xin chào các');
    expect(state.live.s1?.committedChars).toBe(8);
  });

  it('lets a correction replace settled text outright', () => {
    const state = run([delta('s1', 'cơ'), delta('s1', 'cô cứ nhè', '', 1)]);
    expect(state.live.s1?.text).toBe('cô cứ nhè');
    expect(state.live.s1?.text).not.toContain('cơ');
    expect(state.live.s1?.committedChars).toBe(9);
  });

  it('keeps the settled index inside the line when the line is capped', () => {
    const state = run([delta('s1', 'x'.repeat(900), 'tail')]);
    const line = state.live.s1;
    expect(line?.committedChars).toBeLessThanOrEqual(line?.text.length ?? 0);
  });

  it('leaves a client that never receives a delta exactly as before', () => {
    const state = run([partial('s1', 'xin chào'), partial('s1', 'xin chàu')]);
    expect(state.live.s1?.text).toBe('xin chàu');
    expect(state.live.s1?.committedChars).toBeUndefined();
  });

  // The server emits `partial` and then `delta` for the SAME read, as two
  // frames. They arrive in separate ticks, so the view renders the state
  // between them — and that intermediate state paints the whole line as
  // settled, because `committedChars` is not set yet and the renderer reads
  // `undefined` as "all of it is settled". The very next event corrects it to
  // nothing settled at all.
  //
  // Nothing is wrong with the settled text here: at the first read of a turn
  // there IS none, and two reads have to agree before there is. What the pair
  // costs is one frame of the wrong colour at the start of every turn. It is
  // asserted rather than described because it looks exactly like settled text
  // being retracted, and a DOM-watching probe counted it as sixteen violations
  // in a sixteen-turn session before the cause was found.
  it('grows one translation as its pieces arrive', () => {
    const state = run([
      translationDelta('s1', 'I would like '),
      translationDelta('s1', 'to book a room'),
    ]);
    expect(state.live.s1?.translation).toBe('I would like to book a room');
  });

  it('replaces rather than appends when the translation changes', () => {
    // The defect this guards, and it is the ordinary case rather than an edge:
    // every turn past the settled-character threshold is translated more than
    // once, so without the generation check the second translation's pieces
    // land on the first translation's finished text — "HelloHello there".
    const state = run([
      translationDelta('s1', 'Hello', 0),
      translationPartial('s1', 'Hello there'),
      translationDelta('s1', 'Hello there, ', 1),
      translationDelta('s1', 'my friend', 1),
    ]);
    expect(state.live.s1?.translation).toBe('Hello there, my friend');
  });

  it('treats a retried attempt as a restart, not as more text', () => {
    // A provider that abandons one key and retries on another emits a new
    // generation; what it already showed belongs to the attempt that failed.
    const state = run([
      translationDelta('s1', 'I would li', 3),
      translationDelta('s1', 'I would like to book', 4),
    ]);
    expect(state.live.s1?.translation).toBe('I would like to book');
  });

  it('lets the finished translation have the last word', () => {
    const state = run([
      translationDelta('s1', 'I would like ', 0),
      translationPartial('s1', 'I would like to book a room.'),
    ]);
    expect(state.live.s1?.translation).toBe('I would like to book a room.');
  });

  it('keeps appending to a translation the finished text already replaced', () => {
    // `partial` does not clear the generation marker, so a delta from the SAME
    // translation arriving just after it still belongs to that translation.
    const state = run([
      translationDelta('s1', 'I would like ', 0),
      translationPartial('s1', 'I would like '),
      translationDelta('s1', 'to book', 0),
    ]);
    expect(state.live.s1?.translation).toBe('I would like to book');
  });

  it('paints the first read of a turn as settled, then as pending', () => {
    const first = run([partial('s1', 'thì')]);
    expect(first.live.s1?.committedChars).toBeUndefined();

    const second = turnKeyedTranscriptReducer(first, delta('s1', '', 'thì'));
    expect(second.live.s1?.text).toBe('thì');
    expect(second.live.s1?.committedChars).toBe(0);
  });
});
