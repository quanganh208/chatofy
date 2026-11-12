// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Reveal } from './reveal';

/** Motion must never be the reason content is missing. */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
  vi.unstubAllGlobals();
});

function mount(rect: Partial<DOMRect>) {
  act(() => {
    root.render(
      <Reveal as="li">
        <span>content</span>
      </Reveal>,
    );
  });
  void rect;
}

describe('Reveal', () => {
  it('shows its children with no observer available', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    mount({});
    expect(container.textContent).toBe('content');
    expect(container.firstElementChild?.getAttribute('data-reveal')).toBe('rest');
    expect(container.firstElementChild?.tagName).toBe('LI');
  });

  it('leaves everything visible for a reader who prefers reduced motion', () => {
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    mount({});
    expect(container.firstElementChild?.getAttribute('data-reveal')).toBe('rest');
  });

  it('holds a block below the fold, then releases it once seen', () => {
    let notify: (entries: { isIntersecting: boolean }[]) => void = () => {};
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(cb: typeof notify) {
          notify = cb;
        }
        observe() {}
        disconnect() {}
      },
    );
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      top: 5000,
    } as DOMRect);
    mount({});
    expect(container.firstElementChild?.getAttribute('data-reveal')).toBe('held');
    act(() => notify([{ isIntersecting: true }]));
    expect(container.firstElementChild?.getAttribute('data-reveal')).toBe('shown');
  });
});
