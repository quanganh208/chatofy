// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveTurn } from '@chatofy/realtime-client';
import type { TranscriptSegment } from '@chatofy/types';
import { LocaleProvider } from '@/i18n/provider';
import { ConversationTranscript } from './conversation-transcript';
import {
  HANDOFF_WINDOW_MS,
  claimLiveLine,
  endLiveLine,
  recordLiveLine,
  createLiveLineRegistry,
  previouslyDrawn,
  recordDrawn,
} from './live-line-handoff';

describe('claimLiveLine', () => {
  const snapshot = { source: 'xin chào', target: 'hello', rect: null };

  it('takes over a turn’s own line once it has gone, once per consumer', () => {
    const registry = createLiveLineRegistry();
    recordLiveLine(registry, 'a', snapshot);
    // Still on screen: nothing to take over.
    expect(claimLiveLine(registry, ['a'], 'source', 0)).toBeNull();
    endLiveLine(registry, 'a', 100);
    expect(claimLiveLine(registry, ['a'], 'source', 150)?.source).toBe('xin chào');
    expect(claimLiveLine(registry, ['a'], 'source', 150)).toBeNull();
    expect(claimLiveLine(registry, ['a'], 'target', 150)?.target).toBe('hello');
  });

  it('lets the pieces of a split turn take over the parent’s line, unless told not to guess', () => {
    const registry = createLiveLineRegistry();
    recordLiveLine(registry, 'parent', snapshot);
    endLiveLine(registry, 'parent', 100);
    expect(claimLiveLine(registry, ['piece'], 'position', 120, { ownLineOnly: true })).toBeNull();
    expect(claimLiveLine(registry, ['piece'], 'source', 120)?.source).toBe('xin chào');
  });

  it('forgets a line that went away too long ago', () => {
    const registry = createLiveLineRegistry();
    recordLiveLine(registry, 'a', snapshot);
    endLiveLine(registry, 'a', 100);
    expect(claimLiveLine(registry, ['a'], 'source', 100 + HANDOFF_WINDOW_MS + 1)).toBeNull();
    recordLiveLine(registry, 'b', snapshot);
    endLiveLine(registry, 'b', 100 + HANDOFF_WINDOW_MS + 2);
    expect(registry.lines.has('a')).toBe(false);
  });
});

describe('previouslyDrawn', () => {
  it('returns what a regrouped line read, only when every turn in it was drawn', () => {
    const registry = createLiveLineRegistry();
    recordDrawn(registry, 'source', ['a', 'b'], 'một hai');
    recordDrawn(registry, 'source', ['c'], 'ba');
    expect(previouslyDrawn(registry, 'source', ['a', 'b', 'c'])).toBe('một hai ba');
    expect(previouslyDrawn(registry, 'source', ['a', 'd'])).toBeNull();
    expect(previouslyDrawn(registry, 'target', ['a'])).toBeNull();
  });

  it('gives a half of a split block nothing, so the old words are not shown twice', () => {
    const registry = createLiveLineRegistry();
    recordDrawn(registry, 'source', ['a', 'b'], 'một hai');
    expect(previouslyDrawn(registry, 'source', ['a'])).toBeNull();
    expect(previouslyDrawn(registry, 'source', ['b'])).toBeNull();
  });
});

describe('ConversationTranscript handing a live line to its finished turn', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'],
    });
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const finished: TranscriptSegment = {
    id: 'seg-a',
    sessionId: 'a',
    speakerRole: 'speaker_a',
    sourceLanguages: ['vi'],
    translations: { en: 'I was there at 4:00' },
    sourceText: 'tôi có mặt lúc bốn giờ',
    audioUrl: null,
    createdAt: '2026-11-03T00:00:00.000Z',
  };

  const render = async (
    turns: TranscriptSegment[],
    liveTurns: (LiveTurn & { sessionId: string })[],
  ) => {
    await act(async () => {
      root.render(
        <LocaleProvider>
          <ConversationTranscript
            turns={turns}
            liveTurns={liveTurns}
            captures={{}}
            displays={{ a: 'Tôi có mặt lúc 4:00.' }}
            startedAtMs={null}
            audioOffsetMs={null}
            running
            speakers={[]}
            attributions={{}}
            languagePair={{ source: 'vi', target: 'en' }}
            onAttribute={() => {}}
            onUnattribute={() => {}}
            onAddSpeaker={() => {}}
            onRenameSpeaker={() => {}}
            onRemoveSpeaker={() => {}}
          />
        </LocaleProvider>,
      );
      // Let the live line's post-commit measurement run.
      await Promise.resolve();
    });
  };
  const drawn = (selector: string) =>
    container.querySelector(`ol ${selector} > span:first-child`)?.textContent;
  const advance = (ms: number) =>
    act(() => {
      vi.advanceTimersByTime(ms);
    });

  it('starts the finished line from the words the live line showed, then morphs to the final ones', async () => {
    await render(
      [],
      [{ sessionId: 'a', text: 'tôi có mặt lúc bốn giờ', translation: 'I was there at four' }],
    );
    advance(2000);
    await render(
      [],
      [{ sessionId: 'a', text: 'tôi có mặt lúc bốn giờ', translation: 'I was there at four' }],
    );
    await render([finished], []);

    expect(drawn('.reading-source')).toBe('tôi có mặt lúc bốn giờ');
    expect(drawn('.reading-target')).toBe('I was there at four');
    // The reader hears the final text, never the morph.
    expect(container.querySelector('ol .reading-source .sr-only')?.textContent).toBe(
      'Tôi có mặt lúc 4:00.',
    );
    advance(900);
    expect(drawn('.reading-source')).toBe('Tôi có mặt lúc 4:00.');
    expect(drawn('.reading-target')).toBe('I was there at 4:00');
  });

  it('keeps one copy of a finished line once it has settled', async () => {
    await render([finished], []);
    expect(container.querySelector('ol .reading-source .sr-only')).toBeNull();
    expect(container.querySelector('ol .reading-source [aria-hidden]')).toBeNull();
  });

  it('draws a turn that never had a live line whole', async () => {
    await render([finished], []);
    expect(drawn('.reading-source')).toBe('Tôi có mặt lúc 4:00.');
  });

  it('morphs a finished line when its translation is replaced', async () => {
    await render([finished], []);
    await render([{ ...finished, translations: { en: 'I arrived at 4:00' } }], []);
    expect(drawn('.reading-target')).toBe('I was there at 4:00');
    advance(900);
    expect(drawn('.reading-target')).toBe('I arrived at 4:00');
  });
});
