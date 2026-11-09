import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Headings balance and body copy avoids one-word last lines.
 *
 * `impeccable detect` on the landing found four paragraphs ending in a single word
 * ("Facebook.", "giờ.", "again.", "private.") and one unbalanced heading, while only a
 * handful of components opted into `text-wrap` by hand. The rule lives in the base
 * layer so new copy gets it without anyone remembering to ask.
 */
const css = readFileSync(fileURLToPath(new URL('../../app/globals.css', import.meta.url)), 'utf8');
const baseLayer = css.slice(css.indexOf('@layer base'));

describe('text wrapping in the base layer', () => {
  it('balances headings', () => {
    expect(baseLayer).toMatch(/h1,\s*h2,\s*h3,\s*h4\s*\{[^}]*text-wrap:\s*balance/);
  });

  it('avoids one-word last lines in paragraphs', () => {
    expect(baseLayer).toMatch(/\bp\s*\{[^}]*text-wrap:\s*pretty/);
  });
});
