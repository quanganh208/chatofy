// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SubtitleOverlay } from './subtitle-overlay';

/**
 * Caption size belongs to the reader, as in Google Meet's caption settings. The four
 * sizes map onto the product's own type roles rather than arbitrary pixel values.
 */
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const textClass = (size?: 'sm' | 'md' | 'lg' | 'xl') => {
  act(() => root.render(<SubtitleOverlay subtitle="Xin chào" size={size} />));
  return container.querySelector('p')?.className ?? '';
};

describe('SubtitleOverlay size', () => {
  it('defaults to the body size', () => {
    expect(textClass()).toContain('text-body');
  });

  it.each([
    ['sm', 'text-hint'],
    ['md', 'text-body'],
    ['lg', 'text-translation'],
    ['xl', 'text-heading'],
  ] as const)('%s uses %s', (size, cls) => {
    expect(textClass(size)).toContain(cls);
  });

  it('draws nothing without a subtitle', () => {
    act(() => root.render(<SubtitleOverlay subtitle={undefined} size="xl" />));
    expect(container.querySelector('p')).toBeNull();
  });
});
