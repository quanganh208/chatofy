// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TextSizeField } from './text-size-field';
import { TEXT_SIZE_SCALES } from '@/lib/translate-settings';

/**
 * Geometry held together by two utility classes in two different files.
 *
 * The notches align with the thumb only while `inset-x-1.5` here answers `size-4`
 * in `packages/ui/src/react/slider.tsx` and `size-1` on the notches themselves:
 * half the thumb minus half a notch. Change any one of the three and the marks
 * drift toward the ends — a few pixels, at 1 and at 10 only, which is exactly the
 * kind of wrong nobody files a bug about and nobody notices in review.
 *
 * happy-dom does no layout, so none of this can be measured here. What CAN be
 * pinned is the arithmetic's inputs, which is what the assertions below do.
 */

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
});

function render(value = 3) {
  const onChange = vi.fn<(textSize: number) => void>();
  act(() => {
    root.render(<TextSizeField label="Text size" value={value} onChange={onChange} />);
  });
  return onChange;
}

const overlay = () => container.querySelector('.pointer-events-none') as HTMLElement;
/**
 * Scoped to the overlay, and that is not incidental: the thumb carries
 * `rounded-full bg-card` too — it is the fill the notches deliberately borrow —
 * so a document-wide selector counts eleven marks for ten steps.
 */
const notches = () => overlay().children;

describe('TextSizeField', () => {
  it('marks every step the scale actually offers', () => {
    render();
    // Reading the table rather than repeating 10: a step added to
    // `TEXT_SIZE_SCALES` with no mark for it is a stop the reader cannot see.
    expect(notches().length).toBe(TEXT_SIZE_SCALES.length);
  });

  it('insets the marks by half the thumb minus half a mark', () => {
    render();
    // 8px - 2px = 6px. Half the thumb ALONE leaves the end marks 2px out, which
    // is the numbers' old error at a smaller size.
    expect(overlay().className).toContain('inset-x-1.5');
    expect(notches()[0]!.className).toContain('size-1');
  });

  it('draws the marks before the slider, so the thumb stays grabbable', () => {
    render();
    // Two positioned siblings paint in document order. An overlay written after
    // the slider sits on top of the thumb; `pointer-events-none` saves the drag
    // but not the hover or the focus ring.
    const slider = container.querySelector('[data-slot="slider"]')!;
    expect(overlay().compareDocumentPosition(slider) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('spends no words, and none of what it draws is read aloud', () => {
    render();
    // The slider announces its own name and value. The two A's and the ten marks
    // are for the eye; announced, they would be twelve pieces of noise around a
    // control that had already said everything.
    expect(container.querySelector('[data-slot="slider"]')?.getAttribute('aria-label')).toBe(
      'Text size',
    );
    for (const node of container.querySelectorAll('span[aria-hidden], div[aria-hidden]')) {
      expect(node.getAttribute('aria-hidden')).toBe('true');
    }
    expect(overlay().getAttribute('aria-hidden')).toBe('true');
  });

  it('shows the range with the two sizes it moves between', () => {
    render();
    // The anchors are the two role tokens this control multiplies, so they
    // demonstrate the scale instead of numbering it.
    const [small, large] = Array.from(container.querySelectorAll('span[aria-hidden]')).filter(
      (node) => node.textContent === 'A',
    );
    expect(small?.className).toContain('text-hint');
    expect(large?.className).toContain('text-translation');
  });

  it('reports the step the reader landed on', () => {
    const onChange = render(3);
    const slider = container.querySelector('[data-slot="slider"] [role="slider"]')!;
    act(() => {
      slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith(4);
  });
});
