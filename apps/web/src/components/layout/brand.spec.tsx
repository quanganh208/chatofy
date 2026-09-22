// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Brand } from './brand';

/**
 * The product's name on every web surface: the lotus mark, then the wordmark.
 *
 * Three things are held here. The mark is decoration, so it is hidden from
 * assistive tech and the link is still named "Chatofy". The variant follows the
 * size rule — ink below 32px, dawn from 32px — because the dawn centre petal
 * disappears when small. And the mark comes FIRST and the wordmark LAST, which
 * the collapsed sidebar depends on: it hides the last child and keeps the mark.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container.remove();
});

function render(element: React.ReactElement) {
  act(() => {
    root = createRoot(container);
    root.render(element);
  });
  const link = container.querySelector('a');
  if (!link) throw new Error('Brand rendered no link');
  return link;
}

describe('Brand', () => {
  it('is a link home named "Chatofy", with the mark hidden from assistive tech', () => {
    const link = render(<Brand />);
    expect(link.getAttribute('href')).toBe('/');
    expect(link.getAttribute('aria-label')).toBe('Chatofy');
    const mark = link.querySelector('[data-slot="brand-mark"]');
    expect(mark?.getAttribute('aria-hidden')).toBe('true');
  });

  it('puts the mark first and the wordmark last, for the collapsed rail', () => {
    const link = render(<Brand size={20} />);
    expect(link.firstElementChild?.getAttribute('data-slot')).toBe('brand-mark');
    expect(link.lastElementChild?.tagName).toBe('SPAN');
    expect(link.lastElementChild?.textContent).toBe('chatofy');
  });

  it.each([
    [20, 'ink'],
    [24, 'ink'],
    [32, 'dawn'],
  ])('draws the %spx mark as the %s variant', (size, variant) => {
    const link = render(<Brand size={size} />);
    const mark = link.querySelector('[data-slot="brand-mark"]');
    expect(mark?.getAttribute('data-variant')).toBe(variant);
    expect(mark?.getAttribute('width')).toBe(String(size));
  });
});
