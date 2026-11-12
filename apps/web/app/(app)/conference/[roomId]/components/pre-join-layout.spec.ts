import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The lobby's "Join now" is the one action on the screen, so on a phone it has to be on
 * the first screen. Measured at 375x812 it ended at y=832 with 40px page padding and a
 * 40px gap, so the button sat under the fold. The padding and gap are tighter below `lg`
 * and unchanged from it. happy-dom has no box model, so this holds the classes and the
 * 375px screenshot is the real check.
 */
const source = readFileSync(
  fileURLToPath(new URL('./pre-join-panel.tsx', import.meta.url)),
  'utf8',
);

describe('lobby layout on a phone', () => {
  it('tightens padding and gap below lg and keeps the desktop spacing from lg', () => {
    expect(source).toContain('gap-6 px-6 py-4 lg:gap-10 lg:py-10');
  });

  it('keeps the settings on the page ground as hairline rows, with no card or glow', () => {
    expect(source).toContain('border-hairline divide-hairline flex flex-col divide-y border-y');
    expect(source).not.toMatch(/\bCard\b|DawnGlow|shadow-elev/);
  });
});
