// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TranscriptScroller } from './transcript-scroller';

/**
 * The region follows the conversation, and stops when the reader is reading.
 *
 * This exists because the first version of this component did neither. It keyed
 * its effect on `turns.length + liveTurns.length`, which does not change when a
 * translation lands — `server.transcript.final` removes the turn's live lines and
 * appends the settled turn in one step — so the one update worth following was
 * the one it ignored. It shipped, and passed, with no test at all.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  geometry.scrollHeight = 0;
  geometry.clientHeight = 400;
  // On the prototype, so the node created inside the component picks it up before
  // its own layout effect ever runs.
  for (const property of ['scrollHeight', 'clientHeight'] as const) {
    Object.defineProperty(HTMLElement.prototype, property, {
      get: () => geometry[property],
      configurable: true,
    });
  }
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function region(): HTMLElement {
  const node = container.querySelector<HTMLElement>('[role="region"]');
  if (!node) throw new Error('no scroll region');
  return node;
}

/**
 * happy-dom does no layout, so the geometry is supplied — and it has to be
 * readable DURING the commit, because that is when the layout effect measures.
 * Defining it after the render is how the first version of this file managed to
 * assert against a `scrollHeight` of zero.
 *
 * `scrollTop` is left as a real property: the component writes it, and it is what
 * every assertion here reads.
 */
const geometry = { scrollHeight: 0, clientHeight: 400 };

function render(content: string, contentHeight: number): void {
  geometry.scrollHeight = contentHeight;
  act(() => {
    root.render(<TranscriptScroller label="Transcript">{content}</TranscriptScroller>);
  });
}

describe('TranscriptScroller', () => {
  it('follows a turn that lands without changing how many there are', () => {
    // The exact shape of `server.transcript.final`: one live turn is replaced by
    // one settled turn, so every count is the same before and after, and only the
    // CONTENT grew. The version this replaces did not move here.
    render('one live line', 500);
    act(() => {
      region().dispatchEvent(new Event('scroll'));
    });

    render('one settled turn, four lines tall', 900);
    expect(region().scrollTop).toBe(900);
  });

  it('follows a live line that is only getting longer', () => {
    render('đang', 500);
    act(() => {
      region().dispatchEvent(new Event('scroll'));
    });

    render('đang nói một câu dài hơn', 700);
    expect(region().scrollTop).toBe(700);
  });

  it('stops following once the reader scrolls back to read something', () => {
    render('a conversation', 900);
    const node = region();

    // Half a screen up: a deliberate scroll, not a nudge.
    node.scrollTop = 300;
    act(() => {
      node.dispatchEvent(new Event('scroll'));
    });

    render('a conversation, plus a new turn', 1200);
    expect(region().scrollTop, 'the reader was yanked back down').toBe(300);
  });

  it('keeps following after a nudge that never left the end', () => {
    render('a conversation', 900);
    const node = region();

    // 20px from the bottom — a trackpad twitch, or a scroll still settling.
    node.scrollTop = 900 - 400 - 20;
    act(() => {
      node.dispatchEvent(new Event('scroll'));
    });

    render('a conversation, plus a new turn', 1200);
    expect(region().scrollTop).toBe(1200);
  });

  it('resumes following when the reader returns to the end', () => {
    render('a conversation', 900);
    const node = region();

    node.scrollTop = 200;
    act(() => {
      node.dispatchEvent(new Event('scroll'));
    });
    node.scrollTop = 500;
    act(() => {
      node.dispatchEvent(new Event('scroll'));
    });

    render('a conversation, plus a new turn', 1200);
    expect(region().scrollTop).toBe(1200);
  });

  it('is reachable and named for a keyboard reader', () => {
    // Its contents are often only the live line, which holds nothing focusable of
    // its own — so without this the region cannot be read at all in a browser
    // that does not make scrollers focusable.
    render('anything', 500);
    expect(region().getAttribute('tabindex')).toBe('0');
    expect(region().getAttribute('aria-label')).toBe('Transcript');
  });
});
