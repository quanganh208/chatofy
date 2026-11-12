import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Findings from running Emil Kowalski's review-animations rules over the shared components.
 *
 * - A UI surface should open in under 300ms on an ease-out curve. The Sheet (the mobile
 *   sidebar and the landing menu) opened in 500ms on `ease-in-out`, the slowest moment of
 *   the first-run path on a phone.
 * - `transition-all` animates whatever happens to change; name the properties.
 *
 * Class-text spec: motion is not measurable in happy-dom. The project's own motion tokens
 * (docs/design-guidelines.md, Motion) set `duration.base` 200ms and `duration.slow` 320ms.
 */
const read = (file: string) =>
  readFileSync(fileURLToPath(new URL(`./${file}`, import.meta.url)), 'utf8');

describe('motion craft in shared components', () => {
  it('Sheet opens in 300ms or less and does not use ease-in-out', () => {
    const src = read('sheet.tsx');
    expect(src).not.toContain('duration-500');
    expect(src).not.toContain('ease-in-out');
    expect(src).toContain('data-[state=open]:duration-300');
    expect(src).toContain('ease-out');
  });

  it('Sheet closes faster than it opens', () => {
    expect(read('sheet.tsx')).toContain('data-[state=closed]:duration-200');
  });

  it.each(['dialog.tsx', 'alert-dialog.tsx'])(
    '%s opens in 200ms on a decelerating curve and closes faster',
    (file) => {
      const src = read(file);
      expect(src).toContain('data-[state=open]:duration-200');
      expect(src).toContain('data-[state=closed]:duration-150');
      expect(src).toContain('ease-enter');
      expect(src).not.toContain('ease-in-out');
    },
  );

  it('Accordion trigger names the properties it transitions', () => {
    expect(read('accordion.tsx')).not.toMatch(/\btransition-all\b/);
  });
});
