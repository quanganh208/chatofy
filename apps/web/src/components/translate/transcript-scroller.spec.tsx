// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TranscriptScroller } from './transcript-scroller';
import type { TranscriptOrder } from '@/lib/translate-settings';

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

function render(
  content: string,
  contentHeight: number,
  freeScroll = false,
  order: TranscriptOrder = 'oldest-first',
): void {
  geometry.scrollHeight = contentHeight;
  act(() => {
    root.render(
      <TranscriptScroller label="Transcript" freeScroll={freeScroll} order={order}>
        {content}
      </TranscriptScroller>,
    );
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

/**
 * The switch for the one case the gesture cannot express.
 *
 * Scrolling up already stops the following, so this is not a second way to say
 * the same thing: it covers staying put while parked AT the end, where every new
 * turn re-pins the view and there is no scroll that means "stop" without also
 * meaning "take me somewhere else".
 *
 * Asserted from the ANCHORED state on purpose. With the reader already scrolled
 * away the component does nothing either way, so a test written there would pass
 * against a `freeScroll` prop that was never read.
 */
describe('TranscriptScroller with free scroll on', () => {
  it('leaves a reader parked at the end exactly where they are', () => {
    render('first', 600, true);
    const node = region();
    // Anchored: `scrollHeight - scrollTop - clientHeight` is 0, which is what
    // makes this the case only the switch can reach.
    node.scrollTop = 200;
    act(() => {
      node.dispatchEvent(new Event('scroll'));
    });

    render('first and second', 1200, true);
    expect(node.scrollTop).toBe(200);
  });

  it('follows again the moment it is switched off', () => {
    // The value is read on every commit rather than captured once, so turning it
    // off has to resume following without anything else changing.
    render('first', 600, true);
    const node = region();
    node.scrollTop = 200;
    act(() => {
      node.dispatchEvent(new Event('scroll'));
    });

    render('first and second', 1200, false);
    expect(node.scrollTop).toBe(1200);
  });
});

/**
 * Newest first, the newest edge is the TOP: the line being spoken sits above
 * everything, so following means holding `scrollTop` at 0 — and the same slack,
 * remembered anchoring and `freeScroll` apply, measured from that edge.
 */
describe('TranscriptScroller newest first', () => {
  const scrollTo = (node: HTMLElement, top: number) => {
    node.scrollTop = top;
    act(() => {
      node.dispatchEvent(new Event('scroll'));
    });
  };

  it('holds the top while the conversation grows', () => {
    render('a conversation', 900, false, 'newest-first');
    const node = region();
    // Something (a browser keeping its anchor) moved the view a nudge down.
    scrollTo(node, 20);

    render('a new turn, then the conversation', 1200, false, 'newest-first');
    expect(node.scrollTop).toBe(0);
  });

  it('stops following once the reader scrolls down to re-read', () => {
    render('a conversation', 900, false, 'newest-first');
    const node = region();
    scrollTo(node, 300);

    render('a new turn, then the conversation', 1200, false, 'newest-first');
    expect(node.scrollTop, 'the reader was yanked back up').toBe(300);
  });

  it('does not treat parking at the BOTTOM as following', () => {
    // The oldest-first rule measured from the wrong edge would pin here.
    render('a conversation', 900, false, 'newest-first');
    const node = region();
    scrollTo(node, 900 - 400);

    render('a new turn, then the conversation', 1200, false, 'newest-first');
    expect(node.scrollTop).toBe(500);
  });

  it('resumes following when the reader returns to the top', () => {
    render('a conversation', 900, false, 'newest-first');
    const node = region();
    scrollTo(node, 300);
    scrollTo(node, 10);

    render('a new turn, then the conversation', 1200, false, 'newest-first');
    expect(node.scrollTop).toBe(0);
  });

  it('never follows with free scroll on, even parked at the top', () => {
    render('a conversation', 900, true, 'newest-first');
    const node = region();
    scrollTo(node, 30);

    render('a new turn, then the conversation', 1200, true, 'newest-first');
    expect(node.scrollTop).toBe(30);

    render('a new turn, then the conversation', 1200, false, 'newest-first');
    expect(node.scrollTop).toBe(0);
  });
});

/**
 * Switching the order flips the list under the reader, so wherever they were no
 * longer means anything: the switch is a request to see the newest turn.
 */
describe('TranscriptScroller order switch', () => {
  it('follows the newest edge again after the order flips, wherever the reader was', () => {
    render('a conversation', 900);
    const node = region();
    // Oldest first, scrolled up to the very first turn: not following.
    node.scrollTop = 0;
    act(() => {
      node.dispatchEvent(new Event('scroll'));
    });

    render('a conversation, newest first', 900, false, 'newest-first');
    render('a new turn, then the conversation', 1200, false, 'newest-first');
    expect(node.scrollTop, 'new turns did not pin to the top after the switch').toBe(0);
  });

  it('jumps to the newest edge on a switch even with free scroll on', () => {
    render('a conversation', 900, true);
    const node = region();
    node.scrollTop = 200;

    render('a conversation, newest first', 900, true, 'newest-first');
    expect(node.scrollTop).toBe(0);
  });
});

/**
 * Newest first keeps a scrolled-away reader on the turn they were reading, by
 * hand and in every browser (the region turns native anchoring off). happy-dom
 * has no layout, so each turn's place comes from `data-top`/`data-height`.
 */
describe('TranscriptScroller newest-first place-keeping', () => {
  const turn = (id: string, top: number, height: number) => (
    <li key={id} data-id={id} data-top={top} data-height={height} />
  );

  function renderTurns(turns: React.ReactNode[], contentHeight: number, freeScroll = false) {
    geometry.scrollHeight = contentHeight;
    act(() => {
      root.render(
        <TranscriptScroller label="Transcript" order="newest-first" freeScroll={freeScroll}>
          <ol>{turns}</ol>
        </TranscriptScroller>,
      );
    });
  }

  function scrollTo(node: HTMLElement, top: number) {
    node.scrollTop = top;
    act(() => {
      node.dispatchEvent(new Event('scroll'));
    });
  }

  const layoutProperties = ['offsetTop', 'offsetHeight', 'offsetParent'] as const;
  const originals = layoutProperties.map((property) => [
    property,
    Object.getOwnPropertyDescriptor(HTMLElement.prototype, property),
  ]);
  afterEach(() => {
    for (const [property, descriptor] of originals) {
      if (descriptor) Object.defineProperty(HTMLElement.prototype, property as string, descriptor);
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[property as string];
    }
  });

  beforeEach(() => {
    const read = (attribute: string) =>
      function (this: HTMLElement) {
        return Number(this.getAttribute(attribute) ?? 0);
      };
    Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
      get: read('data-top'),
      configurable: true,
    });
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      get: read('data-height'),
      configurable: true,
    });
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
      get: () => null,
      configurable: true,
    });
  });

  it('holds the turn being read when a new one lands above it', () => {
    renderTurns([turn('b', 0, 300), turn('a', 300, 600)], 900);
    const node = region();
    scrollTo(node, 400); // reading turn a, 100px into it

    renderTurns([turn('c', 0, 300), turn('b', 300, 300), turn('a', 600, 600)], 1200);
    expect(node.scrollTop).toBe(700);
  });

  it('does not move the reader when a turn BELOW them grows', () => {
    renderTurns([turn('b', 0, 300), turn('a', 300, 600)], 900);
    const node = region();
    scrollTo(node, 100); // reading turn b

    // A late translation lengthens turn a, which is below b.
    renderTurns([turn('b', 0, 300), turn('a', 300, 900)], 1200);
    expect(node.scrollTop).toBe(100);
  });

  it('falls back to the turn below when the one being read is merged away', () => {
    renderTurns([turn('b', 0, 300), turn('a', 300, 600)], 900);
    const node = region();
    scrollTo(node, 100); // reading b; a is the spare

    // b merges into a block above, which is now taller: a moved down 150px.
    renderTurns([turn('c', 0, 450), turn('a', 450, 600)], 1050);
    expect(node.scrollTop).toBe(250);
  });

  it('holds the reader when text above them grows without the scroller rendering', () => {
    // The live line types in and a polished translation morphs on their own
    // state, frame by frame; only a resize of the content can report that.
    let onResize: (() => void) | null = null;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          onResize = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    try {
      renderTurns([turn('b', 0, 300), turn('a', 300, 600)], 900);
      const node = region();
      scrollTo(node, 400); // reading turn a, 100px into it

      // Turn b, above the reader, grows by 50px as its text types in.
      const below = node.querySelector<HTMLElement>('[data-id="a"]')!;
      below.setAttribute('data-top', '350');
      act(() => onResize?.());
      expect(node.scrollTop).toBe(450);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('holds a free-scroll reader parked at the top instead of following', () => {
    // Native anchoring skips scrollTop 0, which is why this is done by hand.
    renderTurns([turn('b', 0, 300), turn('a', 300, 600)], 900, true);
    const node = region();

    renderTurns([turn('c', 0, 300), turn('b', 300, 300), turn('a', 600, 600)], 1200, true);
    expect(node.scrollTop).toBe(300);
  });

  it('turns the browser anchoring off so the reader is not moved twice', () => {
    renderTurns([turn('a', 0, 300)], 300);
    expect(region().className).toContain('[overflow-anchor:none]');
  });
});
