import { describe, expect, it } from 'vitest';
import type { ServerEvent, TranscriptSegment } from '@chatofy/types';
import {
  initialTurnKeyedTranscript,
  pieceCapture,
  turnKeyedTranscriptReducer,
  type TurnKeyedAction,
  type TurnKeyedTranscript,
} from './turn-keyed-transcript.js';
import { toConversationTurns } from './conversation-turns.js';
import { groupTurnsForDisplay } from './display-groups.js';

const segment = (sessionId: string, sourceText: string): TranscriptSegment => ({
  id: `id-${sessionId}`,
  sessionId,
  speakerRole: 'speaker_a',
  direction: 'en_to_vi',
  sourceText,
  targetText: `<${sourceText}>`,
  audioUrl: null,
  createdAt: '2026-09-28T00:00:00.000Z',
});

/** One piece of `parent`, split two ways at 1200ms of a 2400ms turn. */
const piece = (parent: string, index: 0 | 1, sourceText: string): ServerEvent => ({
  type: 'server.transcript.final',
  sessionId: `${parent}#${index}`,
  segment: segment(`${parent}#${index}`, sourceText),
  split: {
    parentSessionId: parent,
    index,
    count: 2,
    startMs: index === 0 ? 0 : 1200,
    endMs: index === 0 ? 1200 : 2400,
  },
});

const STARTED = 1_000_000;
/** The parent turn: opened 320ms into its own audio, closed 2400ms after its first byte. */
const captured = (sessionId: string, cutForced = false): TurnKeyedAction => ({
  type: 'transcript.turnCaptureRecorded',
  sessionId,
  cutForced,
  openedAt: STARTED + 5320,
  closedAt: STARTED + 7400,
  preRollMs: 320,
});

const play = (...events: TurnKeyedAction[]): TurnKeyedTranscript =>
  events.reduce(turnKeyedTranscriptReducer, initialTurnKeyedTranscript);

describe('a turn split where the voice changed', () => {
  it('shows each piece as its own finished line', () => {
    const state = play(piece('t1', 0, 'Two circles?'), piece('t1', 1, 'Yeah, in the first'));

    expect(state.turns.map((t) => t.sessionId)).toEqual(['t1#0', 't1#1']);
    expect(state.splits['t1#1']).toMatchObject({ parentSessionId: 't1', index: 1 });
  });

  it("clears the parent's live lines, which were the whole turn being spoken", () => {
    const state = play(
      {
        type: 'server.transcript.partial',
        sessionId: 't1',
        text: 'Two circles yeah in',
        speaker: 'speaker_a',
        direction: 'en_to_vi',
      },
      piece('t1', 0, 'Two circles?'),
    );

    expect(state.live).toEqual({});
  });

  it("gives each piece its parent's capture when the capture lands after the pieces", () => {
    const state = play(piece('t1', 0, 'a'), piece('t1', 1, 'b'), captured('t1', true));

    expect(state.captures['t1#0']).toEqual({
      cutForced: false,
      openedAt: STARTED + 5320,
      closedAt: STARTED + 5000 + 1200,
      preRollMs: 320,
    });
    expect(state.captures['t1#1']).toEqual({
      // Only the last piece can run on into the next turn.
      cutForced: true,
      openedAt: STARTED + 5000 + 1200,
      closedAt: STARTED + 7400,
      preRollMs: 0,
    });
  });

  it('gives it the same capture when the capture lands first', () => {
    const late = play(piece('t1', 0, 'a'), piece('t1', 1, 'b'), captured('t1'));
    const early = play(captured('t1'), piece('t1', 0, 'a'), piece('t1', 1, 'b'));

    expect(early.captures['t1#0']).toEqual(late.captures['t1#0']);
    expect(early.captures['t1#1']).toEqual(late.captures['t1#1']);
  });

  it('marks every piece unheard when the turn was never played', () => {
    const state = play(piece('t1', 0, 'a'), piece('t1', 1, 'b'), {
      type: 'transcript.turnAbandoned',
      sessionId: 't1',
      reason: 'backlog',
    });

    expect(state.unheard['t1#0']).toBe('backlog');
    expect(state.unheard['t1#1']).toBe('backlog');
  });

  it('keeps the pieces apart even while nobody is named — the cut was a voice, not the ceiling', () => {
    const state = play(
      piece('t1', 0, 'Two circles?'),
      piece('t1', 1, 'Yeah'),
      captured('t1', true),
    );

    const groups = groupTurnsForDisplay(state.turns, state.captures, state.attributions);
    expect(groups.map((g) => g.sessionIds)).toEqual([['t1#0'], ['t1#1']]);
  });

  it('saves each piece with the time it was said', () => {
    const state = play(piece('t1', 0, 'Two circles?'), piece('t1', 1, 'Yeah'), captured('t1'));

    const rows = toConversationTurns(state, STARTED);
    expect(rows.map((r) => [r.sourceText, r.offsetMs])).toEqual([
      ['Two circles?', 5000],
      ['Yeah', 6200],
    ]);
  });
});

describe('pieceCapture', () => {
  it('leaves a capture with no pre-roll where it opened', () => {
    const parent = { cutForced: false, openedAt: 100, closedAt: 2500 };
    expect(
      pieceCapture(parent, { parentSessionId: 'p', index: 1, count: 3, startMs: 800, endMs: 1600 }),
    ).toEqual({ cutForced: false, openedAt: 900, closedAt: 1700, preRollMs: 0 });
  });
});
