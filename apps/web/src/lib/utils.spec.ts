import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cn, SCALED_TYPE, TYPE_SCALE } from './utils';

const css = readFileSync(fileURLToPath(new URL('../../app/globals.css', import.meta.url)), 'utf8');

describe('cn', () => {
  it.each([...TYPE_SCALE, ...SCALED_TYPE])('keeps text-%s beside a text colour', (role) => {
    expect(cn(`text-${role}`, 'text-foreground')).toBe(`text-${role} text-foreground`);
  });

  /**
   * The stylesheet declares a font size two ways, and both have to be named.
   *
   * A role is a `--text-*` theme value. The transcript's two are `@utility` blocks
   * instead, because the `calc(… * var(--reading-scale))` they carry is not a token
   * — and a scan for `--text-*` cannot see them. That is exactly how they were
   * missed: this test claimed to know "every role the stylesheet declares" while
   * reading only half of where a size can be declared, so `text-source` and
   * `text-target` stayed filed under colour with the suite green.
   */
  it('knows every font size the stylesheet declares, however it is declared', () => {
    const roles = [...css.matchAll(/^\s*--text-([a-z]+):/gm)].map((m) => m[1]);
    const utilities = [...css.matchAll(/@utility text-([a-z]+)\s*\{([^}]*)\}/g)]
      .filter(([, , body]) => /font-size:/.test(body ?? ''))
      .map((m) => m[1]);

    expect([...new Set(roles)].sort()).toEqual([...TYPE_SCALE].sort());
    expect([...new Set(utilities)].sort()).toEqual([...SCALED_TYPE].sort());
  });

  /**
   * The two cases that tell a correct config from one that merely stopped merging
   * `text-*` at all. Naming a size in the colour group and naming it nowhere look
   * identical in the test above; they differ here.
   */
  it('still lets one size replace another', () => {
    expect(cn('text-body', 'text-title')).toBe('text-title');
    expect(cn('text-source', 'text-body')).toBe('text-body');
    expect(cn('text-source', 'text-target')).toBe('text-target');
  });

  it('still lets one colour replace another', () => {
    expect(cn('text-muted-foreground', 'text-foreground')).toBe('text-foreground');
    expect(cn('text-prose', 'text-foreground')).toBe('text-foreground');
  });
});
