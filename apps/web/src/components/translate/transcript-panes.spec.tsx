// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CapturesBySession, SessionSpeaker } from '@chatofy/realtime-client';
import type { TranscriptSegment } from '@chatofy/types';
import { TranscriptPanes } from './transcript-panes';
import { LocaleProvider } from '@/i18n/provider';
import { DEFAULT_TRANSLATE_SETTINGS, type TranslateSettings } from '@/lib/translate-settings';

/**
 * How many scroll regions there are, and what each of them holds.
 *
 * This is the one thing in the whole feature that a typecheck cannot see and a
 * green render does not prove. Every arrangement renders; the differences between
 * them are structural — a pane leaking the other side, a second interactive chip
 * writing the same state, a header naming the pane it is not above — and each of
 * those looks like a working screen.
 *
 * happy-dom does no layout, so nothing here can assert that the panes FIT. That
 * stays a measurement in a real browser, and the risk it covers is recorded on the
 * section's maximum in `cascade-panel.tsx`.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SPEAKERS: SessionSpeaker[] = [{ id: 'speaker-1', label: 'An' }];

const TURNS: TranscriptSegment[] = [
  {
    id: 'seg-a',
    sessionId: 'a',
    speakerRole: 'speaker_a',
    direction: 'vi_to_en',
    sourceText: 'Xin chào',
    targetText: 'Hello',
    audioUrl: null,
    createdAt: '2026-09-04T00:00:00.000Z',
  },
];

const CAPTURES: CapturesBySession = { a: { openedAt: 0, cutForced: false, closedAt: 1_000 } };

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

function render(overrides: Partial<TranslateSettings> = {}) {
  act(() => {
    root.render(
      <LocaleProvider>
        <TranscriptPanes
          settings={{ ...DEFAULT_TRANSLATE_SETTINGS, ...overrides }}
          running={false}
          onSwap={vi.fn()}
          voiceControl={<button type="button">voice slot</button>}
          stream={{
            turns: TURNS,
            liveTurns: [],
            captures: CAPTURES,
            displays: {},
            speakers: SPEAKERS,
            attributions: {},
            onAttribute: vi.fn(),
            onUnattribute: vi.fn(),
            onAddSpeaker: vi.fn(),
            onRenameSpeaker: vi.fn(),
            onRemoveSpeaker: vi.fn(),
          }}
        />
      </LocaleProvider>,
    );
  });
}

const regions = () => Array.from(container.querySelectorAll('[role="region"]'));
const labels = () => regions().map((region) => region.getAttribute('aria-label'));
/**
 * The speaker chip, and ONLY it.
 *
 * `ol button` alone would over-count: `TranscriptSourceLine` renders a disclosure
 * button inside the list for any turn that was repaired. The fixture passes
 * `displays={{}}` so none is, but a later fixture with a repaired turn would make
 * this read as a duplicate-chip regression — which is the one thing these
 * assertions exist to catch.
 */
const chips = () => container.querySelectorAll('ol button[aria-label]');

describe('TranscriptPanes arrangements', () => {
  it('draws one region for the merged list', () => {
    render({ displayMode: 'list' });
    expect(labels()).toEqual(['Transcript']);
  });

  it('draws one region per side when split', () => {
    render({ displayMode: 'split', paneLayout: 'row' });
    expect(labels()).toEqual(['Source transcript', 'Translation transcript']);
  });

  it('draws one region when only the translation is shown', () => {
    // Nothing to split: the arrangement collapses regardless of `displayMode`,
    // which is also why the panel drops the two controls in that state.
    render({ displayMode: 'split', translationOnly: true });
    expect(labels()).toEqual(['Translation transcript']);
  });

  it.each(['row', 'column'] as const)(
    'gives each pane its own header in %s, never one bar naming both',
    (paneLayout) => {
      // A bar naming both is only safe while the two sides are adjacent, and
      // `row` is NOT adjacent below `sm`: the bar's halves stack and so do the
      // panes, putting "Translation" directly above a pane of source text for
      // that pane's whole height. `column` was exempted from the bar for exactly
      // that reason; the narrow case is the same fault at a different width, so
      // both orientations are exempt.
      render({ displayMode: 'split', paneLayout });
      const roles = Array.from(container.querySelectorAll('.border-b .text-label')).map(
        (node) => node.textContent,
      );
      expect(roles).toEqual(['Source', 'Translation']);
    },
  );

  it('puts each header immediately before the pane it names', () => {
    // The ordering IS the claim. Two headers and two panes in the document says
    // nothing on its own — the broken arrangement had exactly that.
    render({ displayMode: 'split', paneLayout: 'row' });
    for (const pane of container.querySelectorAll('[role="region"]')) {
      expect(pane.previousElementSibling?.querySelector('.text-label')).not.toBeNull();
    }
  });

  it('keeps the swap reachable with the panes stacked', () => {
    // It has nowhere to sit between two stacked panes, so it rides the source
    // header. Losing it there would make the direction unchangeable in one
    // arrangement and nowhere else.
    render({ displayMode: 'split', paneLayout: 'column' });
    expect(container.querySelector('button[aria-label^="Swap direction"]')).not.toBeNull();
  });

  it('keeps the voice control reachable in every arrangement', () => {
    for (const settings of [
      { displayMode: 'list' as const },
      { displayMode: 'split' as const, paneLayout: 'row' as const },
      { displayMode: 'split' as const, paneLayout: 'column' as const },
      { translationOnly: true },
    ]) {
      act(() => root.unmount());
      root = createRoot(container);
      render(settings);
      expect(container.textContent).toContain('voice slot');
    }
  });

  it('divides the pair once, and only when there is a pair', () => {
    render({ displayMode: 'split', paneLayout: 'row' });
    expect(container.querySelectorAll('[aria-hidden].bg-hairline').length).toBe(1);

    act(() => root.unmount());
    root = createRoot(container);
    render({ displayMode: 'list' });
    expect(container.querySelectorAll('[aria-hidden].bg-hairline').length).toBe(0);
  });
});

describe('TranscriptPanes and the one interactive chip', () => {
  it('asks who spoke exactly once, however many panes there are', () => {
    // Two chips would be two controls writing one piece of state, with nothing
    // telling the reader they were the same control.
    render({ displayMode: 'split', paneLayout: 'row' });
    expect(chips().length).toBe(1);
    // On the source pane — the words somebody actually spoke.
    expect(regions()[0]!.querySelectorAll('ol button').length).toBe(1);
  });

  it('moves the chip to the translation when that is the only pane', () => {
    render({ translationOnly: true });
    expect(chips().length).toBe(1);
  });

  it('asks nowhere at all with labels off', () => {
    render({ displayMode: 'split', speakerLabels: false });
    expect(chips().length).toBe(0);
  });
});

describe('TranscriptPanes and the reading size', () => {
  const scale = () =>
    container
      .querySelector<HTMLElement>('[style*="--reading-scale"]')
      ?.style.getPropertyValue('--reading-scale');

  it('writes the multiplier once, above every pane', () => {
    render({ textSize: 8 });
    expect(container.querySelectorAll('[style*="--reading-scale"]').length).toBe(1);
    expect(Number(scale())).toBeGreaterThan(1);
  });

  it('is neutral at the default step', () => {
    // Anything else re-typesets the transcript for everyone who never touched the
    // control, on the load after this ships.
    render();
    expect(Number(scale())).toBe(1);
  });
});
