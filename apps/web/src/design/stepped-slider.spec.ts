import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * One rule in `app/globals.css`, one attribute in `packages/ui`, and nothing
 * connecting them but this.
 *
 * `Slider` marks its root `data-stepped`; the rule that eases the handle lives in
 * the app's stylesheet. It has to: Radix positions a thumb by writing `left` on a
 * bare `<span style>` it renders around the thumb, and that span has no class, no
 * slot and no attribute — the only way to reach it is by its place among the
 * root's children. Written as a Tailwind arbitrary variant, that selector has to
 * survive class extraction to exist at all, and it did not. The fill eased to the
 * next stop while the handle jumped to it, which reads worse than no animation.
 *
 * So the two halves live in two packages and neither one fails alone: delete the
 * attribute and the rule matches nothing, delete the rule and the attribute means
 * nothing. Both compile, both render, and the control is simply not smooth.
 */

const css = readFileSync(fileURLToPath(new URL('../../app/globals.css', import.meta.url)), 'utf8');
const slider = readFileSync(
  fileURLToPath(new URL('../../../../packages/ui/src/react/slider.tsx', import.meta.url)),
  'utf8',
);

/** Comments stripped: a commented-out rule is not a rule. */
const source = css.replace(/\/\*[\s\S]*?\*\//g, '');

const SELECTOR = "[data-slot='slider'][data-stepped] > span:last-child";

describe('the stepped slider', () => {
  it('is marked by the component the rule is written for', () => {
    expect(slider).toContain('data-stepped');
  });

  it('eases the handle Radix gave no handle to', () => {
    const rule = new RegExp(
      `${SELECTOR.replace(/[[\]().*+?^$|\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`,
    ).exec(source);
    expect(rule, `no rule for ${SELECTOR}`).not.toBeNull();
    // `left`, because that is the property Radix animates on this element. A
    // `transform` transition here moves nothing.
    expect(rule![1]).toContain('transition: left');
    // The shared tokens, so this cannot drift from every other motion in the kit.
    expect(rule![1]).toContain('var(--duration-fast)');
    expect(rule![1]).toContain('var(--ease-standard)');
  });

  it('stops moving for a reader who asked for stillness', () => {
    // `app-skin-guard.spec.ts` enforces this for TSX and never opens a
    // stylesheet, so a transition written in CSS has no other guard.
    const reduced = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/.exec(source);
    expect(reduced, 'no reduced-motion block').not.toBeNull();
    expect(reduced![1]).toContain('[data-stepped]');
    expect(reduced![1]).toContain('transition: none');
  });
});
