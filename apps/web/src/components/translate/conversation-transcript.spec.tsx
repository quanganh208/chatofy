// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CapturesBySession, SessionSpeaker } from '@chatofy/realtime-client';
import type { TranscriptSegment } from '@chatofy/types';
import { ConversationTranscript } from './conversation-transcript';
import { en } from '@chatofy/i18n';
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
          startedAtMs={null}
          audioOffsetMs={null}
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
 * One stream holding one half of every turn, which is what `split` mounts twice.
 *
 * The two-column grid these tests used to describe is gone: a pane is a single
 * column, so the grid, the chip spanning both of its cells, and the empty
 * translation cell that held the row open have nothing left to do. What replaced
 * them is `side`, and the thing worth guarding is that a stream shows exactly the
 * half it was asked for — a pane leaking the other side is a pane the reader
 * cannot use for the one job it has.
 */
describe('ConversationTranscript as one side of a split', () => {
  // `translation` is EMPTY, not null: the type says a guess is a string and the
  // absence of one is the empty string.
  const live = [{ sessionId: 's-live', text: 'đang nói…', translation: '' }];

  it('keeps the live region in the document before there is a live turn', () => {
    // A live region has to exist BEFORE its content arrives to be announced. It
    // used to be an `aria-live` on each unsettled item — created together with
    // the text it should have spoken — which made the first sentence of every
    // conversation, the one most worth hearing, the one guaranteed to be silent.
    render({ turns: [], liveTurns: [], side: 'source', running: false });
    expect(container.querySelector('[aria-live="polite"]')).not.toBeNull();
  });

  it('holds one region for every unsettled turn, not one each', () => {
    render({ turns: [], liveTurns: live, side: 'source' });
    expect(container.querySelectorAll('[aria-live]').length).toBe(1);
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toContain('đang nói…');
  });

  it('never dims the live line below the contrast floor', () => {
    // The same fault the speaker chip carries a gate for, at the site that
    // finding called the most-watched on the screen: an `opacity-80` saying
    // "unfinished" composited to 3.98:1 on the dark ground and 3.33:1 on the
    // light one, under the 4.5 every token here clears on its own.
    // `contrast-floors.spec.ts` reads TOKENS and cannot see a composited alpha,
    // so the dim passed every gate while breaking the rule they exist for. The
    // dashed rule and the italics carry the state instead.
    render({ turns: [], liveTurns: live, side: 'source' });
    const region = container.querySelector('[aria-live="polite"]')!;
    const dimmed = [region, ...region.querySelectorAll('*')]
      .map((el) => el.getAttribute('class') ?? '')
      // A variant-prefixed `opacity-*` is somebody else's state and not matched.
      .filter((className) => /(?:^|\s)opacity-\d+/.test(className));
    expect(dimmed, 'the live translation line is dimmed').toEqual([]);
  });

  it('says what its own pane is for, not what the other one is for', () => {
    // A pane cannot borrow the other's explanation: in `column` they are half a
    // screen apart, and the empty state is the one frame with no content to work
    // out which is which from.
    render({ turns: [], liveTurns: [], side: 'source', running: false });
    expect(container.textContent).toContain('What you say appears here.');
    expect(container.textContent).not.toContain('The translation appears here.');

    act(() => root.unmount());
    root = createRoot(container);
    render({ turns: [], liveTurns: [], side: 'target', running: false });
    expect(container.textContent).toContain('The translation appears here.');
    expect(container.textContent).not.toContain('What you say appears here.');
  });

  it('lists nothing settled rather than an empty list', () => {
    // A live-only transcript drew an empty `<ol>`: an empty list in the
    // accessibility tree, and its padding stacked on the region's above the one
    // line the reader is waiting for.
    render({ turns: [], liveTurns: live, side: 'source' });
    expect(container.querySelector('ol')).toBeNull();
  });

  it('rules the turn once, whichever half it is holding', () => {
    render({ side: 'source' });
    expect(blocks()[0]!.className).toContain('border-l-2');
  });

  it('shows the source and not the translation', () => {
    render({ side: 'source' });
    expect(container.textContent).toContain('Ghi nhận lúc mười bảy giờ');
    expect(container.textContent).not.toContain('Recorded at 5pm');
  });

  it('shows the translation and not the source', () => {
    render({ side: 'target' });
    expect(container.textContent).toContain('Recorded at 5pm');
    expect(container.textContent).not.toContain('Ghi nhận lúc mười bảy giờ');
  });

  it('drops the live source from the translation pane too', () => {
    // Both panes mount a live region, and the source pane's guess appearing in
    // the translation pane would put the untranslated sentence in the one place
    // that exists to hold the translation.
    render({ turns: [], liveTurns: live, side: 'target' });
    expect(container.textContent).not.toContain('đang nói…');
  });
});

/**
 * Who spoke, and the rule that exactly one stream on screen may be asked.
 *
 * Two interactive chips for one turn would be two controls writing one piece of
 * state with nothing telling the reader they were the same control. The other
 * stream still has to SAY the name — a pane of translations attributed to nobody
 * cannot be followed — so the difference is a readout against a button, and
 * nothing about that difference is visible in a typecheck.
 */
describe('ConversationTranscript speaker labels', () => {
  const chip = () => container.querySelector('ol button');

  it('asks who spoke on the interactive stream', () => {
    render({ side: 'source', interactive: true });
    expect(chip()).not.toBeNull();
  });

  it('states a name without offering to change it on the other one', () => {
    render({
      side: 'target',
      interactive: false,
      attributions: { a: { speakerId: 'speaker-1', origin: 'confirmed' } },
    });
    expect(chip()).toBeNull();
    // The name is still there — it is the control, not the readout, that is gone.
    expect(container.textContent).toContain('An');
  });

  it('asks nothing on the stream that cannot take an answer', () => {
    // The chip's empty state is the words "Who spoke?", which is a call to
    // action. Repeated as inert prose it asks the reader a question this stream
    // offers no way to answer — and in `split` it asked it twice per turn, side
    // by side, once pressable and once not.
    render({ side: 'target', interactive: false });
    expect(container.textContent).not.toContain('Who spoke?');
  });

  it('says nothing at all with labels switched off', () => {
    render({ side: 'source', speakerLabels: false });
    expect(chip()).toBeNull();
    expect(container.textContent).not.toContain('Who spoke?');
    // The turn itself survives: this hides a name, it does not hide a sentence.
    expect(container.textContent).toContain('Ghi nhận lúc mười bảy giờ');
  });

  it('keeps the hint about naming people off the passive stream', () => {
    // It points at a control that stream does not have.
    render({ turns: [], liveTurns: [], side: 'target', interactive: false, speakers: [] });
    expect(container.textContent).not.toContain('Add the people talking');
  });
});

/**
 * A pane must never go blank for a turn it has nothing to draw.
 *
 * This is the regression that shipped for an hour, and the way it shipped is the
 * point: the two-column grid held the translation cell open with an empty `<p>`,
 * and when the grid was replaced by panes that placeholder was deleted TOGETHER
 * WITH the test that guarded it. Nothing went red.
 *
 * The state is the ordinary one. A translation arrives after the sentence it
 * translates, so from the first syllable until the first guess `live.translation`
 * is the empty string — and on the target pane that turn has no source line to
 * fall back on. Counting it as content anyway drops the pane's own empty
 * sentence, while the settled list is still `null`, leaving nothing at all.
 */
describe('ConversationTranscript with a turn it cannot show', () => {
  const speaking = [{ sessionId: 's-live', text: 'đang nói…', translation: '' }];

  it('keeps saying what the pane is for until it has something to put there', () => {
    render({ turns: [], liveTurns: speaking, side: 'target', running: true });
    expect(container.textContent).toContain('The translation appears here.');
  });

  it('shows the guess the moment it arrives', () => {
    render({
      turns: [],
      liveTurns: [{ sessionId: 's-live', text: 'đang nói…', translation: 'speaking…' }],
      side: 'target',
      running: true,
    });
    expect(container.textContent).toContain('speaking…');
    expect(container.textContent).not.toContain('The translation appears here.');
  });

  it('draws no empty wrapper for it either', () => {
    // Before the empty state was restored this still left `pt-5 pb-4` of nothing
    // above the first line, jittering on every turn.
    render({ turns: HALVES, liveTurns: speaking, side: 'target' });
    const region = container.querySelector('[aria-live="polite"]')!;
    expect(region.children.length).toBe(0);
  });

  it('still counts as content on the pane that CAN show it', () => {
    render({ turns: [], liveTurns: speaking, side: 'source', running: true });
    expect(container.textContent).toContain('đang nói…');
    expect(container.textContent).not.toContain('What you say appears here.');
  });
});

/**
 * The bound on "no sentence is lost", made visible.
 *
 * `OrderedPlayback` drops the oldest waiting turn once the queue passes its 12s
 * ceiling, and the transcript kept showing that turn exactly like one that had
 * played. It matters more since the speed presets opened below 1.0x, where the
 * drop stops being a tail event under continuous speech.
 */
describe('turns that were never spoken', () => {
  const UNHEARD = en['web.translate.turnUnheard'];

  it('marks the block whose audio was dropped', () => {
    render({ captures: captures(['a', 1_000, false, 9_000], ['b', 9_130, false, 12_000]) });
    expect(container.textContent).not.toContain(UNHEARD);

    render({
      captures: captures(['a', 1_000, false, 9_000], ['b', 9_130, false, 12_000]),
      unheard: { a: 'backlog' },
    });
    const marked = blocks().filter((block) => block.textContent?.includes(UNHEARD));
    expect(marked).toHaveLength(1);
    expect(marked[0]!.textContent).toContain('Ghi nhận lúc mười bảy giờ');
  });

  it('marks a merged block when any of its turns went unheard', () => {
    // One utterance the ceiling split: audio missing from half of it is audio
    // missing from the block, and the block is what the reader sees.
    render({ unheard: { b: 'stalled' } });
    expect(blocks()).toHaveLength(1);
    expect(blocks()[0]!.textContent).toContain(UNHEARD);
  });

  it('says nothing on a saved conversation, which has no playback to lose', () => {
    render({ unheard: undefined });
    expect(container.textContent).not.toContain(UNHEARD);
  });

  it('marks it on the source pane too', () => {
    // In `split` the reader watching the source side would otherwise be the one
    // person told nothing about a sentence they never heard.
    render({ side: 'source', unheard: { a: 'backlog' } });
    expect(container.textContent).toContain(UNHEARD);
  });
});
