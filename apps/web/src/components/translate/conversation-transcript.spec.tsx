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
    onRenameSpeaker: vi.fn<(speakerId: string, label: string) => void>(),
    onRemoveSpeaker: vi.fn<(speakerId: string) => void>(),
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

  it('shows a repaired line for one member and raw text for the rest', () => {
    render({ displays: { a: 'Ghi nhận lúc 17:00' } });
    expect(blocks()[0]!.textContent).toContain('Ghi nhận lúc 17:00 trời mưa rất to');
  });
});

/**
 * A repaired line is a MODEL's rendering of what somebody said, so the words the
 * recognizer actually produced have to stay reachable. The speaker is the only
 * person who can tell a restored comma from a substituted word, and they can
 * only do it against the original.
 */
describe('ConversationTranscript keeps the recognizer text reachable', () => {
  /**
   * The disclosure, found by its label rather than by position among the chips.
   *
   * English because `LocaleProvider` defaults to `en`; the Vietnamese strings
   * are covered by the dictionary's own parity spec, not by re-rendering this
   * component in both languages.
   */
  const rawToggle = () =>
    Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('As heard'),
    );

  it('offers nothing extra on a turn that was never repaired', () => {
    render({ displays: {} });
    // A disclosure on every turn would teach people to ignore it on the turns
    // where it matters. An unrepaired turn renders exactly the paragraph it
    // rendered before this existed.
    expect(rawToggle()).toBeUndefined();
  });

  it('reveals the recognizer output, labelled as such, on request', () => {
    render({ displays: { a: 'Ghi nhận lúc 17:00' } });

    const toggle = rawToggle();
    expect(toggle).toBeDefined();
    // Closed by default: the repaired line is the reading experience, and the
    // original is there for when somebody doubts it.
    expect(container.textContent).not.toContain('Ghi nhận lúc mười bảy giờ');
    expect(toggle!.getAttribute('aria-expanded')).toBe('false');

    act(() => toggle!.click());

    // Marked in words, not only in styling. Two similar Vietnamese sentences on
    // screen with nothing but a shade of grey between them is worse than not
    // offering the comparison at all.
    expect(container.textContent).toContain('Recognized:');
    expect(container.textContent).toContain('Ghi nhận lúc mười bảy giờ');
    expect(rawToggle()!.getAttribute('aria-expanded')).toBe('true');
  });

  it('shows the raw text of every member, not only the repaired one', () => {
    render({ displays: { a: 'Ghi nhận lúc 17:00' } });
    act(() => rawToggle()!.click());

    // The block is one utterance the ceiling split. Revealing half of it would
    // be a comparison against a sentence that never existed.
    expect(container.textContent).toContain('Ghi nhận lúc mười bảy giờ trời mưa rất to');
  });
});

/**
 * The two-panel layout, which is what `/translate` ships by default and what none
 * of the tests above exercise — every one of them renders the stacked path.
 */
describe('ConversationTranscript in two columns', () => {
  // `translation` is EMPTY, not null: the type says a guess is a string and the
  // absence of one is the empty string — which is also the state that has to
  // hold the translation column open.
  const live = [{ sessionId: 's-live', text: 'đang nói…', translation: '' }];

  it('keeps the live region in the document before there is a live turn', () => {
    // A live region has to exist BEFORE its content arrives to be announced. It
    // used to be an `aria-live` on each unsettled item — created together with
    // the text it should have spoken — which made the first sentence of every
    // conversation, the one most worth hearing, the one guaranteed to be silent.
    render({ turns: [], liveTurns: [], layout: 'columns', running: false });
    expect(container.querySelector('[aria-live="polite"]')).not.toBeNull();
  });

  it('holds one region for every unsettled turn, not one each', () => {
    render({ turns: [], liveTurns: live, layout: 'columns' });
    expect(container.querySelectorAll('[aria-live]').length).toBe(1);
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toContain('đang nói…');
  });

  it('names both panels when there is nothing in either', () => {
    // One sentence spanning both columns leaves the reader to work out which side
    // is which on the one frame with no content to work it out from.
    render({ turns: [], liveTurns: [], layout: 'columns', running: false });
    expect(container.textContent).toContain('What you say appears here.');
    expect(container.textContent).toContain('The translation appears here.');
  });

  it('lists nothing settled rather than an empty list', () => {
    // A live-only transcript drew an empty `<ol>`: an empty list in the
    // accessibility tree, and its padding stacked on the region's above the one
    // line the reader is waiting for.
    render({ turns: [], liveTurns: live, layout: 'columns' });
    expect(container.querySelector('ol')).toBeNull();
  });

  it('spans the speaker chip across both columns, and rules the turn once', () => {
    render({ layout: 'columns' });
    const turn = blocks()[0]!;
    // The rule belongs to the turn, so a two-column turn carries one — not one
    // per cell, which would draw a line down the middle of the pair.
    expect(turn.className).toContain('border-l-2');
    expect(turn.querySelector('.sm\\:col-span-2')).not.toBeNull();
  });

  it('holds the translation column open while a guess has not arrived', () => {
    // Rendered empty rather than omitted: without the cell the source widens
    // across both columns and then jumps back when the translation lands.
    render({ turns: [], liveTurns: live, layout: 'columns' });
    expect(container.querySelector('[aria-live] p[aria-hidden]')).not.toBeNull();
  });
});
