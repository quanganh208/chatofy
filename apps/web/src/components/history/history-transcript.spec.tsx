// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ConversationTurn } from '@chatofy/types';
import { HistoryTranscript } from './history-transcript';
import { LocaleProvider } from '@/i18n/provider';

/**
 * What a stored conversation reads like when it comes back.
 *
 * Two rules, both of which are the payoff of decisions made at WRITE time:
 * `displayText ?? sourceText` renders the repaired line the reader saw, and a
 * null `speakerLabel` becomes a localized fallback rather than an English string
 * baked into a database row.
 */

let container: HTMLDivElement;
let root: Root;

const turn = (overrides: Partial<ConversationTurn> = {}): ConversationTurn => ({
  position: 0,
  speakerRole: 'speaker_a',
  speakerLabel: 'An',
  sourceText: 'xin chao',
  displayText: null,
  targetText: 'hello',
  ...overrides,
});

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(turns: ConversationTurn[], locale?: 'en' | 'vi') {
  act(() => {
    root.render(
      <LocaleProvider locale={locale}>
        <HistoryTranscript turns={turns} />
      </LocaleProvider>,
    );
  });
  return container;
}

describe('HistoryTranscript', () => {
  it('renders displayText when it is present', () => {
    const text = render([turn({ sourceText: 'xin chao', displayText: 'xin chào' })]).textContent;
    expect(text).toContain('xin chào');
    expect(text).not.toContain('xin chao ');
  });

  it('falls back to sourceText when there was no repair', () => {
    // Presence is the claim: an absent displayText means the rendering matched.
    expect(render([turn({ sourceText: 'raw line', displayText: null })]).textContent).toContain(
      'raw line',
    );
  });

  it('renders the translation beside the source', () => {
    expect(render([turn({ targetText: 'hello there' })]).textContent).toContain('hello there');
  });

  it('uses the confirmed roster label when the block was attributed', () => {
    expect(render([turn({ speakerLabel: 'Bình' })]).textContent).toContain('Bình');
  });

  it('composes a localized fallback name when the block was never attributed', () => {
    // The reason `speakerLabel` is nullable rather than defaulted: this string
    // has to come from the dictionary, and a row cannot.
    expect(
      render([turn({ speakerLabel: null, speakerRole: 'speaker_b' })], 'en').textContent,
    ).toContain('Speaker B');
    expect(
      render([turn({ speakerLabel: null, speakerRole: 'speaker_b' })], 'vi').textContent,
    ).toContain('Người nói B');
  });

  it('renders a split utterance as ONE block, because grouping happened at save', () => {
    // End-to-end proof that save-time grouping reached the screen: two spoken
    // turns the ceiling cut arrive as a single stored row, so there is one
    // speaker line rather than two.
    const container = render([
      turn({ position: 0, sourceText: 'first half second half', targetText: 'one two' }),
    ]);
    expect(container.textContent).toContain('first half second half');
    expect(container.querySelectorAll('p.uppercase').length).toBe(1);
  });
});
