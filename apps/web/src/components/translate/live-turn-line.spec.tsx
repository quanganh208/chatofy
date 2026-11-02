// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveTurn } from '@chatofy/realtime-client';
import { LocaleProvider } from '@/i18n/provider';
import { LiveTurnLine } from './live-turn-line';

let container: HTMLDivElement;
let root: Root;

const render = (live: LiveTurn, sides: { source?: boolean; target?: boolean } = {}): void => {
  act(() => {
    root.render(
      <LocaleProvider>
        <LiveTurnLine
          live={live}
          showsSource={sides.source ?? true}
          showsTarget={sides.target ?? true}
          frameClassName="border-l-2"
        />
      </LocaleProvider>,
    );
  });
};
const advance = (ms: number): void => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};
const typed = (selector: string) =>
  container.querySelector(`${selector} > [aria-hidden]`)?.textContent ?? null;
const spoken = (selector: string) =>
  container.querySelector(`${selector} > .sr-only`)?.textContent ?? null;

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'performance',
      'setTimeout',
      'clearTimeout',
    ],
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('LiveTurnLine', () => {
  it('types the source in and keeps the unsettled tail muted', () => {
    render({ text: 'xin chào', committedChars: 4, translation: '' });
    advance(1000);
    expect(typed('p.reading-source')).toBe('xin chào');
    expect(container.querySelector('p.reading-source .text-muted-foreground')?.textContent).toBe(
      'chào',
    );
  });

  it('gives a screen reader the whole line from the first render', () => {
    render({ text: 'xin chào', translation: 'hello' });
    expect(typed('p.reading-source')).toBe('');
    expect(spoken('p.reading-source')).toBe('xin chào');
    expect(spoken('p.text-target')).toBe('hello');
  });

  it('keeps the previous translation on screen while the new one agrees with it', () => {
    render({ text: 'xin chào bạn', translation: 'Hello my friend' });
    advance(1000);
    render({ text: 'xin chào bạn', translation: 'Hello' });
    expect(typed('p.text-target')).toBe('Hello my friend');
    expect(spoken('p.text-target')).toBe('Hello');
  });

  it('draws only the side its pane shows', () => {
    render({ text: 'xin chào', translation: 'hello' }, { source: false });
    expect(container.querySelector('p.reading-source')).toBeNull();
    expect(container.textContent).not.toContain('xin chào');
  });

  it('never dims the line with opacity', () => {
    render({ text: 'xin chào', committedChars: 3, translation: 'hello' });
    advance(1000);
    const dimmed = [...container.querySelectorAll('*')]
      .map((el) => el.getAttribute('class') ?? '')
      .filter((className) => /(?:^|\s)opacity-\d+/.test(className));
    expect(dimmed).toEqual([]);
  });
});
