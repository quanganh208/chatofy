// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CapturesBySession, SessionSpeaker } from '@chatofy/realtime-client';
import type { TranscriptSegment } from '@chatofy/types';
import { ConversationTranscript } from './conversation-transcript';
import { LocaleProvider } from '@/i18n/provider';

/**
 * What this transcript must keep being true about, whatever it is restyled into.
 *
 * The load-bearing one is the grouping. The length ceiling cuts a turn mid-word
 * while the speaker is still going, so reading a paragraph aloud arrives as two
 * or three turns — and shown one per turn, the reader is asked who spoke three
 * times about one sentence. Getting that wrong is invisible in a typecheck and
 * looks like a recogniser fault on screen.
 */

const SPEAKERS: SessionSpeaker[] = [
  { id: 'speaker-1', label: 'An' },
  { id: 'speaker-2', label: 'Bình' },
];

const segment = (sessionId: string, sourceText: string, targetText: string): TranscriptSegment => ({
  id: `seg-${sessionId}`,
  sessionId,
  speakerRole: 'speaker_a',
  direction: 'vi_to_en',
  sourceText,
  targetText,
  audioUrl: null,
  createdAt: '2026-08-27T00:00:00.000Z',
});

/** Rows are `[sessionId, openedAt, cutForced, closedAt]`. */
const captures = (...rows: [string, number, boolean, number][]): CapturesBySession =>
  Object.fromEntries(
    rows.map(([id, openedAt, cutForced, closedAt]) => [id, { openedAt, cutForced, closedAt }]),
  );

/** One utterance cut at the 8s ceiling: the next turn opens 130ms after the cut. */
const CUT_UTTERANCE = captures(['a', 1_000, true, 9_000], ['b', 9_130, false, 12_000]);

const HALVES = [
  segment('a', 'Ghi nhận lúc mười bảy giờ', 'Recorded at 5pm'),
  segment('b', 'trời mưa rất to', 'it rained hard'),
];

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

const render = (props: Partial<Parameters<typeof ConversationTranscript>[0]> = {}) => {
  const handlers = {
    onAttribute: vi.fn<(sessionId: string, speakerId: string) => void>(),
    onUnattribute: vi.fn<(sessionId: string) => void>(),
    onAddSpeaker: vi.fn<() => void>(),
  };
  act(() => {
    root.render(
      <LocaleProvider>
        <ConversationTranscript
          turns={HALVES}
          liveTurns={[]}
          captures={CUT_UTTERANCE}
          displays={{}}
          running
          speakers={SPEAKERS}
          attributions={{}}
          {...handlers}
          {...props}
        />
      </LocaleProvider>,
    );
  });
  return handlers;
};

const blocks = () => Array.from(container.querySelectorAll('ol > li'));

describe('ConversationTranscript grouping', () => {
  it('shows a ceiling-cut utterance as one block with one speaker prompt', () => {
    render();
    // Two turns, one block — and crucially one prompt, not two.
    expect(blocks()).toHaveLength(1);
    expect(container.querySelectorAll('button').length).toBeGreaterThan(0);
    expect(blocks()[0]!.textContent).toContain('Ghi nhận lúc mười bảy giờ trời mưa rất to');
  });

  it('keeps two blocks when the speaker actually stopped', () => {
    render({ captures: captures(['a', 1_000, false, 9_000], ['b', 9_130, false, 12_000]) });
    expect(blocks()).toHaveLength(2);
  });

  // Capture records arrive after their segments, so this is the state every
  // merged block passes through. It must render, un-merged, rather than break.
  it('renders un-merged before the capture records land', () => {
    render({ captures: {} });
    expect(blocks()).toHaveLength(2);
  });

  it('attributes every member of a merged block, not just the one the chip reads', () => {
    const handlers = render();
    const chip = container.querySelector('button');
    act(() => {
      chip!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const option = Array.from(container.querySelectorAll('button')).find((node) =>
      node.textContent?.includes('An'),
    );
    // The roster opens as a menu; if the label is not reachable the fan-out
    // cannot be asserted, and a silently-skipped assertion is worse than none.
    expect(option, 'expected the speaker roster to offer "An"').toBeTruthy();
    act(() => {
      option!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(handlers.onAttribute.mock.calls.map(([sessionId]) => sessionId).sort()).toEqual([
      'a',
      'b',
    ]);
  });

  // A group splits only when BOTH sides are confirmed and disagree, so a group
  // can hold one confirmed member beside unattributed ones. Reading the first
  // member blindly would render `fallback` while state says An — and the next
  // tap would overwrite a confirmation the screen never showed.
  it('shows a confirmed attribution held by a later member of the block', () => {
    render({ attributions: { b: { speakerId: 'speaker-1', origin: 'confirmed' } } });
    expect(blocks()).toHaveLength(1);
    expect(blocks()[0]!.textContent).toContain('An');
  });

  it('splits a block when a person confirmed two different speakers', () => {
    render({
      attributions: {
        a: { speakerId: 'speaker-1', origin: 'confirmed' },
        b: { speakerId: 'speaker-2', origin: 'confirmed' },
      },
    });
    expect(blocks()).toHaveLength(2);
  });

  // The producer is the display-repair phase; this proves the read path is
  // already in place and falls back per member.
  it('shows a repaired line for one member and raw text for the rest', () => {
    render({ displays: { a: 'Ghi nhận lúc 17:00' } });
    expect(blocks()[0]!.textContent).toContain('Ghi nhận lúc 17:00 trời mưa rất to');
  });
});
