import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { cn, TYPE_SCALE } from './utils.js';

/**
 * The type scale survives being merged with an ink colour.
 *
 * `tailwind-merge` treats every `text-*` utility as one conflict group and reads
 * its meaning from a table of Tailwind's own defaults. A role-named size it has
 * never heard of is filed as a colour, and then the last `text-*` in the string
 * wins — so `cn('text-body', 'text-primary-foreground')` returned the colour by
 * itself, with the size dropped and nothing to see in the source.
 *
 * What that shipped: one `Button` rendering at three sizes. 12px in the extension
 * popup, where an extension page's default `body` is 12px; 16px on web, the
 * browser default; and 14px for `outline` alone, which sets no ink colour and so
 * kept its size by accident. Every one of them inherited a size rather than
 * applying the one the component declares.
 *
 * These are unit tests over `cn` rather than a source scan on purpose. The bug is
 * in what the function RETURNS, and a source scan would have found nothing wrong
 * — `text-body` was present in every one of those components the whole time.
 */
describe('cn keeps the type scale out of the colour conflict group', () => {
  const COLOURS = [
    'text-foreground',
    'text-muted-foreground',
    'text-primary-foreground',
    'text-secondary-foreground',
    'text-card-foreground',
    'text-destructive',
    'text-accent-text',
    'text-on-live-fill',
    'text-prose',
    'text-current',
  ];

  it.each(TYPE_SCALE.flatMap((size) => COLOURS.map((colour) => [size, colour] as const)))(
    'text-%s survives %s',
    (size, colour) => {
      const merged = cn(`text-${size}`, colour).split(' ');
      expect(merged, 'the size was dropped as if it were a competing colour').toContain(
        `text-${size}`,
      );
      expect(merged, 'the colour was dropped instead').toContain(colour);
    },
  );

  it('still lets one size replace another', () => {
    // The half that must keep working: two sizes ARE a real conflict, and a
    // caller's override has to win. A config that simply exempted `text-*` from
    // merging would pass the tests above and break this one.
    expect(cn('text-body', 'text-title')).toBe('text-title');
    expect(cn('text-title', 'text-hint')).toBe('text-hint');
  });

  it('still lets one colour replace another', () => {
    expect(cn('text-muted-foreground', 'text-foreground')).toBe('text-foreground');
  });

  it('resolves a size and a colour independently, in either order', () => {
    expect(
      cn('text-body text-muted-foreground', 'text-hint text-foreground').split(' ').sort(),
    ).toEqual(['text-foreground', 'text-hint']);
  });

  /**
   * The list in `utils.ts` is the third place these names are written — after
   * `tokens.ts`'s keys and each surface's `--text-*` aliases. A role added to the
   * stylesheets and forgotten here would be silently swallowed by a colour again,
   * which is the exact failure this file exists for, so the two are compared.
   */
  it('names every role the stylesheet declares', () => {
    const css = readFileSync(
      fileURLToPath(new URL('../../../../apps/web/app/globals.css', import.meta.url)),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '');

    const declared = [...css.matchAll(/--text-([\w-]+):\s*\d/g)]
      .map((match) => match[1]!)
      .filter((name) => !name.endsWith('--line-height'));

    expect(declared.length, 'no --text-* roles found — has globals.css moved?').toBeGreaterThan(0);
    expect([...declared].sort()).toEqual([...TYPE_SCALE].sort());
  });
});
