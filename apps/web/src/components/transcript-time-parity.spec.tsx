// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toConversationTurns, type CapturesBySession } from '@chatofy/realtime-client';
import { HISTORY_LIMITS, type TranscriptSegment } from '@chatofy/types';
import { ConversationTranscript } from '@/components/translate/conversation-transcript';
import { HistoryTranscript } from '@/components/history/history-transcript';
import { LocaleProvider } from '@/i18n/provider';

/**
 * The timestamps on the two screens are ONE number, and this is what says so.
 *
 * A block marked `0:07` while it is being spoken has to read `0:07` when the
 * conversation is opened again in History. The two screens compute it at
 * different times, from different shapes — live from capture records held in a
 * reducer, stored from rows a projection wrote and an API read back — so nothing
 * about their agreement is structural. It holds because both call
 * `displayGroupOffsetMs` and then `mediaOffset`, and this spec is the only place
 * that would notice if one of them stopped.
 *
 * Both halves render from ONE source state: the live transcript takes the turns
 * and captures directly, and the history transcript takes what
 * `toConversationTurns` makes of the same state — which is precisely what the
 * save sends. A fixture that hand-wrote the stored rows would be asserting that
 * two hard-coded strings match.
 *
 * ## What "the same" is a claim about, and what it is not
 *
 * The claim is per BLOCK, not per row on screen, and two known cases separate
 * the two. Both are the projection's existing shape rather than anything this
 * added, and both are in contract:
 *
 * - A block longer than a stored field becomes several rows, every one carrying
 *   the BLOCK's offset — so one live line can read back as three rows all
 *   stamped `1:12`. That is the honest reading: the pieces were said at one
 *   moment, and giving the tail a later time would invent a pause. The last case
 *   below holds it.
 * - A block the recognizer produced no text for is dropped before `position` is
 *   assigned, so it has a time on the live screen and no history row at all.
 *   Nothing is mismatched — there is no stored row to disagree with — but it
 *   means "block N" is not an index the two screens share.
 *
 * In `split` the time renders once per pane, like the speaker chip beside it:
 * each pane is a whole reading of the conversation, not half of one.
 */

/**
 * Rows are `[sessionId, openedAt, cutForced, closedAt, preRollMs?]`, as epoch ms.
 *
 * The pre-roll is omitted by every case that is not about it — which is also the
 * shape a capture recorded before that field existed has, and it must go on
 * reading exactly as it did.
 */
const captures = (...rows: [string, number, boolean, number, number?][]): CapturesBySession =>
  Object.fromEntries(
    rows.map(([id, openedAt, cutForced, closedAt, preRollMs]) => [
      id,
      { openedAt, cutForced, closedAt, ...(preRollMs === undefined ? {} : { preRollMs }) },
    ]),
  );

const segment = (sessionId: string, sourceText: string, targetText: string): TranscriptSegment => ({
  id: `seg-${sessionId}`,
  sessionId,
  speakerRole: 'speaker_a',
  direction: 'vi_to_en',
  sourceText,
  targetText,
  audioUrl: null,
  createdAt: '2026-09-17T01:00:00.000Z',
});

const STARTED_AT = '2026-09-17T01:00:00.000Z';
const STARTED_AT_MS = Date.parse(STARTED_AT);

/**
 * Three blocks at 7s, 74s and 3671s into the conversation.
 *
 * The last one is past an hour on purpose: `formatOffset` widens to `h:mm:ss`
 * there, and a screen that formatted its own number would be free to widen at a
 * different point.
 */
const TURNS: TranscriptSegment[] = [
  segment('a', 'xin chào', 'hello'),
  segment('b', 'rất vui được gặp bạn', 'nice to meet you'),
  segment('c', 'hẹn gặp lại', 'see you again'),
];

const CAPTURES = captures(
  ['a', STARTED_AT_MS + 7_000, false, STARTED_AT_MS + 9_000],
  ['b', STARTED_AT_MS + 74_000, false, STARTED_AT_MS + 77_000],
  ['c', STARTED_AT_MS + 3_671_000, false, STARTED_AT_MS + 3_673_000],
);

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/** Every visible timestamp in the tree, top to bottom. */
const times = () =>
  [...container.querySelectorAll('time')].map((element) => element.textContent ?? '');

function renderLive(audioOffsetMs: number | null) {
  act(() => {
    root.render(
      <LocaleProvider>
        <ConversationTranscript
          turns={TURNS}
          liveTurns={[]}
          captures={CAPTURES}
          displays={{}}
          startedAtMs={STARTED_AT_MS}
          audioOffsetMs={audioOffsetMs}
          speakers={[]}
          attributions={{}}
          onAttribute={vi.fn()}
          onUnattribute={vi.fn()}
          onAddSpeaker={vi.fn()}
          onRenameSpeaker={vi.fn()}
          onRemoveSpeaker={vi.fn()}
        />
      </LocaleProvider>,
    );
  });
  return times();
}

function renderStored(audioOffsetMs: number | null) {
  // Exactly what the save sends: the projection over the same state, measured
  // from the same conversation start.
  const stored = toConversationTurns(
    { turns: TURNS, speakers: [], attributions: {}, captures: CAPTURES, displays: {} },
    STARTED_AT_MS,
  );
  act(() => {
    root.render(
      <LocaleProvider>
        <HistoryTranscript turns={stored} audioOffsetMs={audioOffsetMs} />
      </LocaleProvider>,
    );
  });
  return times();
}

describe('a turn reads the same live and in history', () => {
  it('agrees when a recording shifts both screens', () => {
    // 1.4s of permission prompt and device open between the conversation
    // starting and the first sample landing. Both screens subtract it.
    const live = renderLive(1_400);
    act(() => root.unmount());
    root = createRoot(container);
    const stored = renderStored(1_400);

    expect(live).toEqual(['0:05', '1:12', '1:01:09']);
    expect(stored).toEqual(live);
  });

  it('agrees when no recording was ever stored', () => {
    // The branch that would drift: with no bucket configured the upload never
    // runs, so history has no shift to apply — and the live screen must have
    // reported the same unshifted numbers rather than media time it could not
    // back up. Both read conversation time.
    const live = renderLive(null);
    act(() => root.unmount());
    root = createRoot(container);
    const stored = renderStored(null);

    expect(live).toEqual(['0:07', '1:14', '1:01:11']);
    expect(stored).toEqual(live);
  });

  it('takes the capture pre-roll off BOTH screens, or neither is right', () => {
    // The pump prepends audio captured before the gate confirmed speech, so the
    // block starts earlier than `openedAt` and `displayGroupOffsetMs` subtracts
    // it. Correcting one screen and not the other is the live/history
    // disagreement `transcript-time.ts:52` records as having shipped once, and
    // the parity above cannot see it: a case with no pre-roll agrees whether or
    // not the subtraction happens at all.
    //
    // 6_500ms is chosen so the correction CROSSES a whole second — 5.1s without
    // it, 4.78s with it. `formatOffset` floors to seconds, so a pre-roll that
    // stayed inside one second would render the same string either way, and the
    // case would be agreement about nothing for a second reason.
    const turns = [segment('a', 'xin chào', 'hello')];
    const live = (map: CapturesBySession): string[] => {
      act(() => {
        root.render(
          <LocaleProvider>
            <ConversationTranscript
              turns={turns}
              liveTurns={[]}
              captures={map}
              displays={{}}
              startedAtMs={STARTED_AT_MS}
              audioOffsetMs={1_400}
              speakers={[]}
              attributions={{}}
              onAttribute={vi.fn()}
              onUnattribute={vi.fn()}
              onAddSpeaker={vi.fn()}
              onRenameSpeaker={vi.fn()}
              onRemoveSpeaker={vi.fn()}
            />
          </LocaleProvider>,
        );
      });
      const drawn = times();
      act(() => root.unmount());
      root = createRoot(container);
      return drawn;
    };
    const stored = (map: CapturesBySession): string[] => {
      const rows = toConversationTurns(
        { turns, speakers: [], attributions: {}, captures: map, displays: {} },
        STARTED_AT_MS,
      );
      act(() => {
        root.render(
          <LocaleProvider>
            <HistoryTranscript turns={rows} audioOffsetMs={1_400} />
          </LocaleProvider>,
        );
      });
      const drawn = times();
      act(() => root.unmount());
      root = createRoot(container);
      return drawn;
    };

    const withPreRoll = captures(['a', STARTED_AT_MS + 6_500, false, STARTED_AT_MS + 9_000, 320]);
    expect(live(withPreRoll)).toEqual(['0:04']);
    expect(stored(withPreRoll)).toEqual(['0:04']);

    // The same instant with nothing recorded before it reads a second later on
    // both screens. That is what says the move above is the pre-roll being
    // subtracted rather than the fixture being picked to land there.
    const noPreRoll = captures(['a', STARTED_AT_MS + 6_500, false, STARTED_AT_MS + 9_000]);
    expect(live(noPreRoll)).toEqual(['0:05']);
    expect(stored(noPreRoll)).toEqual(['0:05']);
  });

  it('shows no time on either screen for a block with no capture record', () => {
    // The record arrives separately from the segment it describes, so a block
    // can render before its own timestamp exists. Neither screen may guess at
    // one: `0:00` would claim the block opened the conversation.
    act(() => {
      root.render(
        <LocaleProvider>
          <ConversationTranscript
            turns={[segment('z', 'chưa có bản ghi', 'no record yet')]}
            liveTurns={[]}
            captures={{}}
            displays={{}}
            startedAtMs={STARTED_AT_MS}
            audioOffsetMs={1_400}
            speakers={[]}
            attributions={{}}
            onAttribute={vi.fn()}
            onUnattribute={vi.fn()}
            onAddSpeaker={vi.fn()}
            onRenameSpeaker={vi.fn()}
            onRemoveSpeaker={vi.fn()}
          />
        </LocaleProvider>,
      );
    });
    expect(times()).toEqual([]);
    expect(container.textContent).toContain('no record yet');
  });

  it('marks a block even with speaker labels turned off', () => {
    // The time does not live on the speaker chip, it shares a line with it. A
    // reader who turned names off still gets their timestamps.
    act(() => {
      root.render(
        <LocaleProvider>
          <ConversationTranscript
            turns={TURNS}
            liveTurns={[]}
            captures={CAPTURES}
            displays={{}}
            startedAtMs={STARTED_AT_MS}
            audioOffsetMs={1_400}
            speakerLabels={false}
            speakers={[]}
            attributions={{}}
            onAttribute={vi.fn()}
            onUnattribute={vi.fn()}
            onAddSpeaker={vi.fn()}
            onRenameSpeaker={vi.fn()}
            onRemoveSpeaker={vi.fn()}
          />
        </LocaleProvider>,
      );
    });
    expect(times()).toEqual(['0:05', '1:12', '1:01:09']);
  });

  it('shows nothing before a conversation has started', () => {
    // `startedAtMs` is null until the first `start`, and there is no origin to
    // measure against. The turns still render.
    act(() => {
      root.render(
        <LocaleProvider>
          <ConversationTranscript
            turns={TURNS}
            liveTurns={[]}
            captures={CAPTURES}
            displays={{}}
            startedAtMs={null}
            audioOffsetMs={null}
            speakers={[]}
            attributions={{}}
            onAttribute={vi.fn()}
            onUnattribute={vi.fn()}
            onAddSpeaker={vi.fn()}
            onRenameSpeaker={vi.fn()}
            onRemoveSpeaker={vi.fn()}
          />
        </LocaleProvider>,
      );
    });
    expect(times()).toEqual([]);
    expect(container.textContent).toContain('hello');
  });

  it("stamps every row of a cap-split block with the block's own time", () => {
    // A block too long for a stored field becomes several rows. They are one
    // utterance, so they share one timestamp — the live screen draws it once,
    // history draws it on each piece, and the STRING is the same on all of them.
    const long = 'a'.repeat(HISTORY_LIMITS.MAX_TURN_CHARS + 500);
    const state = {
      turns: [segment('a', long, long)],
      speakers: [],
      attributions: {},
      captures: captures(['a', STARTED_AT_MS + 74_000, false, STARTED_AT_MS + 80_000]),
      displays: {},
    };
    const stored = toConversationTurns(state, STARTED_AT_MS);
    expect(stored.length).toBeGreaterThan(1);

    act(() => {
      root.render(
        <LocaleProvider>
          <HistoryTranscript turns={stored} audioOffsetMs={1_400} />
        </LocaleProvider>,
      );
    });
    const drawn = times();
    expect(drawn).toHaveLength(stored.length);
    expect(new Set(drawn)).toEqual(new Set(['1:12']));
  });
});
