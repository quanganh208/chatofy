// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { TranscriptSegment } from '@chatofy/types';
import { FullscreenStage } from './fullscreen-stage';
import type { StreamProps } from './transcript-panes';
import { IDLE_REVEAL_DELAY_MS } from '@/hooks/use-idle-reveal';
import { LocaleProvider } from '@/i18n/provider';
import { DEFAULT_TRANSLATE_SETTINGS, type TranslateSettings } from '@/lib/translate-settings';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TURNS: TranscriptSegment[] = [
  {
    id: 'seg-a',
    sessionId: 'a',
    speakerRole: 'speaker_a',
    sourceLanguages: ['vi'],
    translations: { en: 'Hello' },
    sourceText: 'Xin chào',
    audioUrl: null,
    createdAt: '2026-09-04T00:00:00.000Z',
  },
];

const STREAM: StreamProps = {
  turns: TURNS,
  liveTurns: [],
  captures: { a: { openedAt: 0, cutForced: false, closedAt: 1_000 } },
  displays: {},
  startedAtMs: 0,
  audioOffsetMs: null,
  speakers: [{ id: 'speaker-1', label: 'An' }],
  attributions: {},
  onAttribute: vi.fn(),
  onUnattribute: vi.fn(),
  onAddSpeaker: vi.fn(),
  onRenameSpeaker: vi.fn(),
  onRemoveSpeaker: vi.fn(),
};

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
  vi.useRealTimers();
});

function render(
  overrides: Partial<TranslateSettings> = {},
  {
    status = 'idle',
    onStart = vi.fn(),
    onExit = vi.fn(),
    pause = vi.fn(),
  }: { status?: 'idle' | 'listening'; onStart?: Mock; onExit?: Mock; pause?: Mock } = {},
) {
  act(() => {
    root.render(
      <LocaleProvider>
        <FullscreenStage
          settings={{ ...DEFAULT_TRANSLATE_SETTINGS, ...overrides }}
          onChange={vi.fn()}
          running={status !== 'idle'}
          stream={STREAM}
          conversationLanguagePair={{ source: 'vi', target: 'en' }}
          languageMode={null}
          conversation={{
            status,
            level: 0,
            startedAt: null,
            pauses: [],
            pause,
            resume: vi.fn(),
            end: vi.fn(),
          }}
          onStart={onStart}
          awaitingContext={false}
          contextUnready={false}
          onExit={onExit}
        />
      </LocaleProvider>,
    );
  });
  return { onStart, onExit, pause };
}

const bar = () => container.querySelector<HTMLElement>('[data-stage-bar]')!;
const button = (label: string) =>
  container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

describe('FullscreenStage', () => {
  it('keeps the page’s split, in the stage’s look', () => {
    render({ displayMode: 'split', paneLayout: 'row' });
    expect(container.querySelector('[aria-label="Source transcript"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Translation transcript"]')).not.toBeNull();
    const look = container.querySelector<HTMLElement>('[style*="--reading-scale"]')!;
    expect(look.style.getPropertyValue('--reading-bg')).toBe('#000000');
  });

  it('keeps a merged list when the page is a list', () => {
    render({ displayMode: 'list' });
    expect(container.querySelector('[aria-label="Source transcript"]')).toBeNull();
    expect(container.textContent).toContain('Xin chào');
    expect(container.textContent).toContain('Hello');
  });

  it('names the pair without offering to change it', () => {
    render();
    expect(container.querySelector('[data-slot="select-trigger"]')).toBeNull();
    expect(container.querySelector('button[aria-label^="Swap languages"]')).toBeNull();
    expect(container.textContent).toContain('Vietnamese');
  });

  it('starts, pauses and exits from its own bar', () => {
    const idle = render();
    const start = Array.from(bar().querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Start conversation'),
    )!;
    act(() => start.click());
    expect(idle.onStart).toHaveBeenCalledOnce();

    const live = render({}, { status: 'listening' });
    const pause = Array.from(bar().querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Pause'),
    )!;
    act(() => pause.click());
    expect(live.pause).toHaveBeenCalledOnce();

    act(() => button('Exit full screen')!.click());
    expect(live.onExit).toHaveBeenCalledOnce();
  });

  it('focuses the way out on arrival', () => {
    render();
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Exit full screen');
  });

  it('opens the display settings inside itself, not on the body', async () => {
    render();
    await act(async () => {
      button('Display settings')!.click();
      await Promise.resolve();
    });
    const panel = document.querySelector('[data-slot="popover-content"]');
    expect(panel).not.toBeNull();
    expect(container.contains(panel)).toBe(true);
  });
});

describe('FullscreenStage bar', () => {
  it('hides when left alone and comes back on a pointer move', () => {
    vi.useFakeTimers();
    render();
    // Arrival focuses the exit, and a test DOM calls every focus keyboard focus —
    // which holds the bar. A reader who clicked their way in has neither.
    act(() => (document.activeElement as HTMLElement).blur());
    expect(bar().dataset.awake).toBe('true');
    act(() => {
      vi.advanceTimersByTime(IDLE_REVEAL_DELAY_MS);
    });
    expect(bar().dataset.awake).toBe('false');
    act(() => {
      bar().parentElement!.dispatchEvent(new Event('pointermove', { bubbles: true }));
    });
    expect(bar().dataset.awake).toBe('true');
  });

  it('stays up while its settings panel is open', async () => {
    vi.useFakeTimers();
    render();
    await act(async () => {
      button('Display settings')!.click();
      await Promise.resolve();
    });
    act(() => {
      vi.advanceTimersByTime(IDLE_REVEAL_DELAY_MS * 3);
    });
    expect(bar().dataset.awake).toBe('true');
  });
});
