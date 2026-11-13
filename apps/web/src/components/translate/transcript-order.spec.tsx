// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CapturesBySession, LiveTurn } from '@chatofy/realtime-client';
import type { TranscriptSegment } from '@chatofy/types';
import { TranscriptPanes } from './transcript-panes';
import { CaptionStage } from './caption-stage';
import { LocaleProvider } from '@/i18n/provider';
import { DEFAULT_TRANSLATE_SETTINGS, type TranslateSettings } from '@/lib/translate-settings';

/**
 * Which end of the conversation a live view starts from.
 *
 * Asserted on the text as a reader meets it, top to bottom, in every arrangement
 * that draws a stream: the merged list, both panes of `split`, translation-only,
 * and the caption window. Newest first must turn over the turns AND put the line
 * being spoken above them; oldest first must stay exactly the chat it was.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const segment = (sessionId: string, source: string, target: string): TranscriptSegment => ({
  id: `seg-${sessionId}`,
  sessionId,
  speakerRole: 'speaker_a',
  sourceLanguages: ['vi'],
  translations: { en: target },
  sourceText: source,
  audioUrl: null,
  createdAt: '2026-09-04T00:00:00.000Z',
});

const TURNS = [
  segment('a', 'Câu một', 'Sentence one'),
  segment('b', 'Câu hai', 'Sentence two'),
  segment('c', 'Câu ba', 'Sentence three'),
];

// Three separate utterances: nothing cut by the ceiling, so nothing groups.
const CAPTURES: CapturesBySession = {
  a: { openedAt: 0, cutForced: false, closedAt: 1_000 },
  b: { openedAt: 2_000, cutForced: false, closedAt: 3_000 },
  c: { openedAt: 4_000, cutForced: false, closedAt: 5_000 },
};

const LIVE: (LiveTurn & { sessionId: string })[] = [
  { sessionId: 'live', text: 'Đang nói', translation: 'Speaking now' },
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

const stream = {
  turns: TURNS,
  liveTurns: LIVE,
  captures: CAPTURES,
  displays: {},
  startedAtMs: null,
  audioOffsetMs: null,
  speakers: [],
  attributions: {},
  onAttribute: vi.fn(),
  onUnattribute: vi.fn(),
  onAddSpeaker: vi.fn(),
  onRenameSpeaker: vi.fn(),
  onRemoveSpeaker: vi.fn(),
};

function renderPanes(overrides: Partial<TranslateSettings>) {
  act(() => {
    root.render(
      <LocaleProvider locale="en">
        <TranscriptPanes
          conversationMode="one-way"
          settings={{ ...DEFAULT_TRANSLATE_SETTINGS, ...overrides }}
          running
          stream={stream}
        />
      </LocaleProvider>,
    );
  });
}

/** Each scroll region's lines, in the order they appear in the document. */
function readingOrder(region: Element, lines: readonly string[]): string[] {
  const text = region.textContent ?? '';
  for (const line of lines) expect(text, `missing "${line}"`).toContain(line);
  return [...lines].sort((a, b) => text.indexOf(a) - text.indexOf(b));
}

const regions = () => Array.from(container.querySelectorAll('[role="region"]'));

const SOURCE_OLDEST = ['Câu một', 'Câu hai', 'Câu ba', 'Đang nói'];
const TARGET_OLDEST = ['Sentence one', 'Sentence two', 'Sentence three', 'Speaking now'];
const SOURCE_NEWEST = ['Đang nói', 'Câu ba', 'Câu hai', 'Câu một'];
const TARGET_NEWEST = ['Speaking now', 'Sentence three', 'Sentence two', 'Sentence one'];

describe('transcript order on the page', () => {
  it('defaults to oldest first, with the live line at the bottom', () => {
    expect(DEFAULT_TRANSLATE_SETTINGS.transcriptOrder).toBe('oldest-first');
    renderPanes({ displayMode: 'list' });
    const [list] = regions();
    expect(readingOrder(list!, SOURCE_OLDEST)).toEqual(SOURCE_OLDEST);
    expect(readingOrder(list!, TARGET_OLDEST)).toEqual(TARGET_OLDEST);
  });

  it('turns the merged list over newest first, live line on top', () => {
    renderPanes({ displayMode: 'list', transcriptOrder: 'newest-first' });
    const [list] = regions();
    expect(readingOrder(list!, SOURCE_NEWEST)).toEqual(SOURCE_NEWEST);
    expect(readingOrder(list!, TARGET_NEWEST)).toEqual(TARGET_NEWEST);
    // Each block still holds its own two halves together.
    const text = list!.textContent ?? '';
    expect(text.indexOf('Câu ba')).toBeLessThan(text.indexOf('Sentence three'));
    expect(text.indexOf('Sentence three')).toBeLessThan(text.indexOf('Câu hai'));
  });

  it.each(['row', 'column'] as const)(
    'turns BOTH split panes over the same way in %s, so a turn sits level in each',
    (paneLayout) => {
      renderPanes({ displayMode: 'split', paneLayout, transcriptOrder: 'newest-first' });
      const [source, target] = regions();
      expect(readingOrder(source!, SOURCE_NEWEST)).toEqual(SOURCE_NEWEST);
      expect(readingOrder(target!, TARGET_NEWEST)).toEqual(TARGET_NEWEST);
      // Same number of settled rows in each pane, in the same sequence.
      const rows = (pane: Element) => pane.querySelectorAll('ol > li').length;
      expect(rows(source!)).toBe(3);
      expect(rows(target!)).toBe(3);
    },
  );

  it('keeps split oldest first when the reader has not asked otherwise', () => {
    renderPanes({ displayMode: 'split' });
    const [source, target] = regions();
    expect(readingOrder(source!, SOURCE_OLDEST)).toEqual(SOURCE_OLDEST);
    expect(readingOrder(target!, TARGET_OLDEST)).toEqual(TARGET_OLDEST);
  });

  it('turns translation-only over too', () => {
    renderPanes({ translationOnly: true, transcriptOrder: 'newest-first' });
    const [only] = regions();
    expect(readingOrder(only!, TARGET_NEWEST)).toEqual(TARGET_NEWEST);
    expect(only!.textContent).not.toContain('Câu một');
  });

  it('puts several live lines on top, the latest first', () => {
    act(() => {
      root.render(
        <LocaleProvider locale="en">
          <TranscriptPanes
            conversationMode="one-way"
            settings={{
              ...DEFAULT_TRANSLATE_SETTINGS,
              displayMode: 'list',
              transcriptOrder: 'newest-first',
            }}
            running
            stream={{
              ...stream,
              liveTurns: [
                { sessionId: 'l1', text: 'Đầu tiên', translation: '' },
                { sessionId: 'l2', text: 'Thứ hai', translation: '' },
              ],
            }}
          />
        </LocaleProvider>,
      );
    });
    const [list] = regions();
    const order = ['Thứ hai', 'Đầu tiên', 'Câu ba', 'Câu một'];
    expect(readingOrder(list!, order)).toEqual(order);
  });
});

describe('transcript order in the caption window', () => {
  function renderCaptions(overrides: Partial<TranslateSettings>) {
    act(() => {
      root.render(
        <LocaleProvider locale="en">
          <CaptionStage
            settings={{ ...DEFAULT_TRANSLATE_SETTINGS, ...overrides }}
            running
            stream={stream}
            languagePair={{ source: 'vi', target: 'en' }}
          />
        </LocaleProvider>,
      );
    });
  }

  it('reads oldest first by default', () => {
    renderCaptions({});
    const [captions] = regions();
    expect(readingOrder(captions!, TARGET_OLDEST)).toEqual(TARGET_OLDEST);
  });

  it('reads newest first when asked', () => {
    renderCaptions({ transcriptOrder: 'newest-first' });
    const [captions] = regions();
    expect(readingOrder(captions!, TARGET_NEWEST)).toEqual(TARGET_NEWEST);
  });
});
