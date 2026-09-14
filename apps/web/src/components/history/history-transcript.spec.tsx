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
  // Null by default: a row stored before timestamps existed is the case the
  // gutter has to render without breaking, so it is the one the fixtures default
  // to.
  offsetMs: null,
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

function render(
  turns: ConversationTurn[],
  locale?: 'en' | 'vi',
  recording?: { audioOffsetMs: number | null; onSeek?: (ms: number) => void },
) {
  act(() => {
    root.render(
      <LocaleProvider locale={locale}>
        <HistoryTranscript
          turns={turns}
          audioOffsetMs={recording?.audioOffsetMs ?? null}
          onSeek={recording?.onSeek}
        />
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

  describe('the timestamp gutter', () => {
    it('shows nothing for a row stored before timestamps existed', () => {
      // Not `0:00`. A row with no capture record has no position to show, and a
      // zero would claim the block opened the conversation.
      const container = render([turn({ offsetMs: null })], 'en', { audioOffsetMs: 0 });
      expect(container.querySelector('time')).toBeNull();
    });

    it('shows MEDIA time, not conversation time', () => {
      // The number in the gutter must be the number on the player. A turn 6.2s
      // into the conversation, on a recording that began 1.4s in, sits at 4.8s of
      // media — so this reads 0:04, not 0:06.
      //
      // This is the assertion that would have caught the bug where the seek
      // subtracted `audioOffsetMs` and the label did not: with a zero offset both
      // spellings agree, which is why the fixture uses a non-zero one.
      const container = render([turn({ offsetMs: 6_200 })], 'en', { audioOffsetMs: 1_400 });
      expect(container.querySelector('time')?.textContent).toBe('0:04');
    });

    it('seeks to the same moment it displays', () => {
      const seeks: number[] = [];
      const container = render([turn({ offsetMs: 6_200 })], 'en', {
        audioOffsetMs: 1_400,
        onSeek: (ms) => seeks.push(ms),
      });
      act(() => {
        container.querySelector('button')?.click();
      });
      // 4,800ms — the same 0:04 the label shows, to the millisecond. A label and a
      // seek computed by different expressions is exactly the drift this pairs.
      expect(seeks).toEqual([4_800]);
    });

    it('is plain text, not a button, when there is nothing to seek', () => {
      // An old conversation or a failed upload. A button that did nothing would
      // invite a press and answer with silence.
      const container = render([turn({ offsetMs: 6_200 })], 'en', { audioOffsetMs: null });
      expect(container.querySelector('time')).not.toBeNull();
      expect(container.querySelector('button')).toBeNull();
    });

    it('names the button for a reader who cannot see the layout', () => {
      // Tabbing to a bare number announces a number. The accessible name is what
      // says pressing it moves the player, and it carries the time in both
      // languages.
      const en = render([turn({ offsetMs: 6_200 })], 'en', {
        audioOffsetMs: 1_400,
        onSeek: () => {},
      }).querySelector('button');
      expect(en?.getAttribute('aria-label')).toBe('Play from 0:04');

      const vi = render([turn({ offsetMs: 6_200 })], 'vi', {
        audioOffsetMs: 1_400,
        onSeek: () => {},
      }).querySelector('button');
      expect(vi?.getAttribute('aria-label')).toBe('Nghe từ 0:04');
    });

    it('marks the time as a real duration', () => {
      const container = render([turn({ offsetMs: 72_000 })], 'en', { audioOffsetMs: 0 });
      expect(container.querySelector('time')?.getAttribute('dateTime')).toBe('PT1M12S');
    });
  });
});
