import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cn, TYPE_SCALE } from './utils';

describe('cn', () => {
  it.each(TYPE_SCALE)('keeps text-%s beside a text colour', (role) => {
    expect(cn(`text-${role}`, 'text-foreground')).toBe(`text-${role} text-foreground`);
  });

  it('knows every role the stylesheet declares', () => {
    const css = readFileSync(
      fileURLToPath(new URL('../../app/globals.css', import.meta.url)),
      'utf8',
    );
    const roles = [...css.matchAll(/^\s*--text-([a-z]+):/gm)].map((m) => m[1]);
    expect([...new Set(roles)].sort()).toEqual([...TYPE_SCALE].sort());
  });
});
