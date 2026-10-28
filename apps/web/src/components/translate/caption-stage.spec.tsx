// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TranscriptSegment } from '@chatofy/types';
import { CaptionStage } from './caption-stage';
import { CaptionWindowPortal } from './caption-window-portal';
import type { StreamProps } from './transcript-panes';
import { LocaleProvider } from '@/i18n/provider';
import {
  DEFAULT_STAGE_APPEARANCE,
  DEFAULT_TRANSLATE_SETTINGS,
  type TranslateSettings,
} from '@/lib/translate-settings';

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
});

function render(overrides: Partial<TranslateSettings> = {}) {
  act(() => {
    root.render(
      <LocaleProvider>
        <CaptionStage
          settings={{ ...DEFAULT_TRANSLATE_SETTINGS, ...overrides }}
          running
          stream={STREAM}
          languagePair={{ source: 'vi', target: 'en' }}
        />
      </LocaleProvider>,
    );
  });
}

const look = () => container.querySelector<HTMLElement>('[style*="--reading-scale"]')!;

describe('CaptionStage', () => {
  it('draws the stage look, not the page one, on one element', () => {
    render();
    expect(container.querySelectorAll('[style*="--reading-scale"]').length).toBe(1);
    expect(look().style.getPropertyValue('--reading-bg')).toBe('#000000');
    expect(look().classList).toContain('reading-scheme-dark');
    expect(Number(look().style.getPropertyValue('--reading-scale'))).toBeGreaterThan(1);
  });

  it('draws the page look when told to follow it', () => {
    render({
      textSize: 3,
      stage: { ...DEFAULT_STAGE_APPEARANCE, followPage: true },
      appearance: { ...DEFAULT_TRANSLATE_SETTINGS.appearance, targetColor: '#abcdef' },
    });
    expect(look().style.getPropertyValue('--reading-target')).toBe('#abcdef');
    expect(look().style.getPropertyValue('--reading-bg')).toBe('');
    expect(look().style.getPropertyValue('--reading-scale')).toBe('1');
  });

  it('shows both halves in one stream, or only the translation', () => {
    render();
    expect(container.textContent).toContain('Xin chào');
    expect(container.textContent).toContain('Hello');
    render({ translationOnly: true });
    expect(container.textContent).not.toContain('Xin chào');
    expect(container.textContent).toContain('Hello');
  });

  it('carries no control at all — names are copies here', () => {
    render();
    expect(container.querySelectorAll('button').length).toBe(0);
  });

  it('honours the stage’s own time switch', () => {
    render();
    expect(container.querySelector('time')).not.toBeNull();
    render({ stage: { ...DEFAULT_STAGE_APPEARANCE, showTime: false } });
    expect(container.querySelector('time')).toBeNull();
  });
});

describe('CaptionWindowPortal', () => {
  it('renders into another document, with no close of its own', () => {
    // The browser frame around the window already closes it — a Picture-in-
    // Picture window's title bar, or the popup's own — so a second X inside
    // would close the same window twice over.
    const other = document.implementation.createHTMLDocument('');
    const mount = other.createElement('div');
    other.body.append(mount);
    act(() => {
      root.render(
        <LocaleProvider>
          <CaptionWindowPortal
            container={mount}
            settings={DEFAULT_TRANSLATE_SETTINGS}
            running
            stream={STREAM}
            languagePair={{ source: 'vi', target: 'en' }}
          />
        </LocaleProvider>,
      );
    });
    expect(mount.textContent).toContain('Hello');
    expect(container.textContent).toBe('');
    expect(mount.querySelectorAll('button')).toHaveLength(0);
  });
});
