// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UseStreamingTranslate } from '@/hooks/use-streaming-translate';
import type { UseConversationSave } from '@/hooks/use-conversation-save';
import { CascadePanel } from './cascade-panel';
import { LocaleProvider } from '@/i18n/provider';
import { DEFAULT_TRANSLATE_SETTINGS } from '@/lib/translate-settings';

/**
 * What a failed save is allowed to take away from the screen.
 *
 * Minutes are drawn from the STORED conversation, so a conversation that never
 * landed has nothing to summarize and the panel goes. A conversation that DID
 * land keeps it: the failure after that belongs to an edit, and the row it edits
 * is still in the database — with a summary possibly already on screen, drawn
 * from it.
 */

const useStreamingTranslate = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-streaming-translate', () => ({ useStreamingTranslate }));

const useConversationSave = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-conversation-save', () => ({ useConversationSave }));

let container: HTMLDivElement;
let root: Root;

/** A finished conversation with one block in it, held at one identity. */
const conversation: UseStreamingTranslate = {
  status: 'idle',
  turns: [
    {
      id: 'seg-a',
      sessionId: 'a',
      speakerRole: 'speaker_a',
      direction: 'vi_to_en',
      sourceText: 'xin chào',
      targetText: 'hello',
      audioUrl: null,
      createdAt: '2026-09-03T00:00:00.000Z',
    },
  ],
  liveTurns: [],
  speakers: [],
  attributions: {},
  captures: { a: { openedAt: 1_000, cutForced: false, closedAt: 3_000 } },
  displays: {},
  stats: {
    totalTurns: 1,
    confirmed: 0,
    automatic: 0,
    pending: 0,
    fallback: 1,
    tapRate: 0,
    suggestions: { confirmedMatching: 0, corrected: 0, unreviewed: 0 },
  },
  addSpeaker: vi.fn(),
  renameSpeaker: vi.fn(),
  removeSpeaker: vi.fn(),
  attributeTurn: vi.fn(),
  unattributeTurn: vi.fn(),
  echoHeard: 0,
  error: null,
  level: 0,
  conversationId: 'c-1',
  startedAt: '2026-09-03T00:00:00.000Z',
  start: vi.fn(),
  stop: vi.fn(),
  setVolume: vi.fn(),
};

function render(save: Pick<UseConversationSave, 'saved' | 'failure'>): void {
  useStreamingTranslate.mockReturnValue(conversation);
  useConversationSave.mockReturnValue({ ...save, saving: false, retry: vi.fn() });
  act(() => {
    root.render(
      <LocaleProvider>
        <CascadePanel
          settings={DEFAULT_TRANSLATE_SETTINGS}
          onChange={vi.fn()}
          getVolume={() => 1}
        />
      </LocaleProvider>,
    );
  });
}

const generateButton = (): HTMLButtonElement | undefined =>
  Array.from(container.querySelectorAll('button')).find((button) =>
    /Generate|Regenerate/.test(button.textContent ?? ''),
  );

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe('CascadePanel', () => {
  it('keeps the minutes panel when a stored conversation fails a later edit', () => {
    // The conversation was written; renaming a speaker afterwards was refused
    // for good. Nothing about that unstores the row, so the summary stays
    // reachable — and one already generated stays on screen.
    render({ saved: true, failure: 'terminal' });

    expect(container.textContent).toContain('Meeting minutes');
    expect(generateButton()?.disabled).toBe(false);
  });

  it('drops the minutes panel when nothing was stored and no retry can change that', () => {
    render({ saved: false, failure: 'terminal' });

    expect(container.textContent).not.toContain('Meeting minutes');
  });

  it('keeps the minutes panel while a failed save can still be retried', () => {
    render({ saved: false, failure: 'retryable' });

    expect(container.textContent).toContain('Meeting minutes');
    // Not yet stored, so there is nothing to summarize from until the retry
    // lands — the panel says so rather than disappearing.
    expect(generateButton()?.disabled).toBe(true);
  });
});
