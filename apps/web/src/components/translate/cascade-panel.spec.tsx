// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UseStreamingTranslate } from '@/hooks/use-streaming-translate';
import type { UseConversationSave } from '@/hooks/use-conversation-save';
import { CascadePanel } from './cascade-panel';
import { LocaleProvider } from '@/i18n/provider';
import { DEFAULT_TRANSLATE_SETTINGS } from '@/lib/translate-settings';
import { en } from '@chatofy/i18n';

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

// The readiness banner probes the service, and an unmocked `checkHealth` is a real
// `fetch` at the API base URL — a suite that reaches the network, passes or fails on
// whether a dev server happens to be up, and settles state outside `act`.
const checkHealth = vi.hoisted(() => vi.fn<() => Promise<void>>());
vi.mock('@/clients/api-client', () => ({ checkHealth: () => checkHealth() }));

// The banner reads the browser, not a prop. Without these it reports `unknown`,
// renders nothing, and a test about what it renders would pass on an empty DOM.
type FakePermissionStatus = Pick<PermissionStatus, 'state'> & {
  addEventListener: () => void;
  removeEventListener: () => void;
};
const permissionQuery = vi.fn<() => Promise<FakePermissionStatus>>();
Object.defineProperty(navigator, 'permissions', {
  configurable: true,
  value: { query: () => permissionQuery() },
});
Object.defineProperty(navigator, 'mediaDevices', {
  configurable: true,
  value: {
    enumerateDevices: () => Promise.resolve([{ kind: 'audioinput' }]),
    addEventListener: () => {},
    removeEventListener: () => {},
  },
});

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
  checkHealth.mockResolvedValue(undefined);
  permissionQuery.mockResolvedValue({
    state: 'granted',
    addEventListener() {},
    removeEventListener() {},
  });
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
  it('does not say the same thing twice when a microphone is refused', async () => {
    // A refused microphone calls `stop()` before `onError`, so the session is back
    // to `idle` by the time the error lands and the pre-flight banner is eligible
    // to render again. Both would carry `web.translate.micDenied` — one from
    // `open-microphone.ts`, one from the banner — as two assertive live regions.
    useStreamingTranslate.mockReturnValue({
      ...conversation,
      turns: [],
      error: en['web.translate.micDenied'],
    });
    useConversationSave.mockReturnValue({
      saved: false,
      failure: null,
      saving: false,
      retry: vi.fn(),
    });
    checkHealth.mockResolvedValue(undefined);
    permissionQuery.mockResolvedValue({
      state: 'denied',
      addEventListener() {},
      removeEventListener() {},
    });
    await act(async () => {
      root.render(
        <LocaleProvider>
          <CascadePanel
            settings={DEFAULT_TRANSLATE_SETTINGS}
            onChange={vi.fn()}
            getVolume={() => 1}
          />
        </LocaleProvider>,
      );
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    });

    const alerts = [...container.querySelectorAll('[role="alert"]')].filter((el) =>
      el.textContent?.includes(en['web.translate.micDenied']),
    );
    expect(alerts.length, 'the fault is reported once, by the reactive path').toBe(1);
  });

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

/**
 * The invariant the transcript's height rests on.
 *
 * `transcript-scroller.tsx` used to cap itself at 416px so the dock — status,
 * level, and the one action — could not be pushed under the fold. The cap is
 * gone and the transcript now takes the leftover height, which is only safe
 * because nothing renders BELOW the dock while a conversation is running: the
 * attribution stats and the minutes are both `!running`.
 *
 * That is an ordinary-looking pair of conditions holding up a layout decision
 * made in another file, which is exactly the kind of thing a later change
 * removes without noticing. Anything added under the dock has to be gated the
 * same way, or the transcript starts surrendering height mid-sentence — on the
 * screen whose whole job is to be readable while someone talks.
 */
describe('what sits below the dock', () => {
  const renderRunning = () => {
    checkHealth.mockResolvedValue(undefined);
    permissionQuery.mockResolvedValue({
      state: 'granted',
      addEventListener() {},
      removeEventListener() {},
    });
    useStreamingTranslate.mockReturnValue({ ...conversation, status: 'listening' });
    useConversationSave.mockReturnValue({
      saved: false,
      failure: null,
      saving: false,
      retry: vi.fn(),
    });
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
    return container.firstElementChild;
  };

  it('renders nothing after the dock while a conversation is running', () => {
    // Asserted through position rather than through the absence of two known
    // strings: a third thing added under the dock would pass an absence check
    // and still break the layout.
    const panel = renderRunning();
    const dock = panel?.lastElementChild;

    expect(dock?.textContent).toContain(en['web.translate.end']);
  });

  it('puts the results below the dock once the talking stops', () => {
    // The other half of the same rule. Stats and minutes are meant to be down
    // there — the column simply grows past the viewport and the page scrolls,
    // which is fine when nobody is mid-sentence.
    render({ saved: true, failure: null });
    const panel = container.firstElementChild;

    expect(panel?.lastElementChild?.textContent).toContain('Meeting minutes');
  });
});
