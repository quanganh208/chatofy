import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Two panes side by side only where there is room for both, and no box around them.
 *
 * At 375px the list once kept a fixed 288px and the detail pane was squeezed to about
 * 86px. happy-dom has no box model, so the layout cannot be measured here; this holds
 * the classes that make it one pane at a time below `md`, and the screenshots at
 * 375/768/1440 are the real check.
 */
const read = (file: string) => readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8');

describe('glossary layout', () => {
  const page = read('./glossary-page-content.tsx');

  it('stacks below md and puts the panes side by side from md', () => {
    expect(page).toMatch(/flex flex-col md:flex-row/);
    expect(page).toContain('w-full md:sticky md:top-4 md:w-72');
  });

  it('shows one pane at a time on a phone: the list, or the glossary chosen from it', () => {
    expect(page).toMatch(/selected \? 'max-md:hidden' : undefined/);
    expect(page).toMatch(/selected \? undefined : 'max-md:hidden'/);
  });

  it('divides the panes with a hairline instead of wrapping them in a bordered box', () => {
    expect(page).toContain('bg-hairline hidden w-px self-stretch md:block');
    expect(page).not.toMatch(/rounded-lg/);
    expect(page).not.toMatch(/\bborder\b(?!-)/);
  });
});
