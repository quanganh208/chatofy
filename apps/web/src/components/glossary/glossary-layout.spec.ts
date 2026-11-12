import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Two panes side by side only where there is room for both.
 *
 * At 375px the list kept its fixed 288px and the detail pane was squeezed to about
 * 86px, so its sentence fell one word to a line. happy-dom has no box model, so the
 * layout cannot be measured here; this holds the classes that make the panes stack
 * below `md`, and the screenshot at 375px is the real check.
 */
const read = (file: string) => readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8');

describe('glossary layout', () => {
  it('stacks the list above the detail below md and puts them side by side from md', () => {
    const page = read('./glossary-page-content.tsx');
    expect(page).toMatch(/flex flex-col md:flex-row/);
  });

  it('lets the list take the full width when stacked and 18rem from md', () => {
    const list = read('./glossary-list-panel.tsx');
    expect(list).toContain('w-full md:w-72');
    expect(list).toContain('md:border-r');
  });
});
