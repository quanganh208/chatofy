import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { THEME_STORAGE_KEY } from './theme';

/**
 * The one value that exists twice.
 *
 * The blocking script in `app/layout.tsx` runs before any module loads, so it cannot
 * import the key it reads — it is inlined into the document head as a string. Rename
 * the constant without touching the script and nothing fails: the page keeps working,
 * the toggle keeps working, and the choice silently stops surviving a reload, because
 * one side writes to a key the other never looks at.
 */
const LAYOUT = readFileSync(
  fileURLToPath(new URL('../../app/layout.tsx', import.meta.url)),
  'utf8',
);

describe('the blocking theme script', () => {
  it('reads the same storage key the rest of the app writes', () => {
    expect(LAYOUT).toContain('THEME_STORAGE_KEY');
    expect(THEME_STORAGE_KEY).toBe('chatofy.theme');
  });

  it('applies the class before the body renders', () => {
    // Below <body> it is no longer a blocking script, and the flash it exists to
    // prevent comes back with nothing failing.
    const head = LAYOUT.indexOf('<head>');
    const body = LAYOUT.indexOf('<body>');
    const script = LAYOUT.indexOf('dangerouslySetInnerHTML');
    expect(head).toBeGreaterThan(-1);
    expect(script).toBeGreaterThan(head);
    expect(script).toBeLessThan(body);
  });

  it('keeps the attribute React did not write from being reported', () => {
    // The server renders no theme class, so without this React warns on every load
    // and the warning trains people to ignore warnings.
    expect(LAYOUT).toContain('suppressHydrationWarning');
  });

  it('cannot throw the page away', () => {
    // It runs before any error handling exists. An unguarded throw here leaves the
    // document unstyled rather than merely on the wrong ground.
    const inline = /__html: `([^`]*)`/.exec(LAYOUT)?.[1] ?? '';
    expect(inline).toContain('try{');
    expect(inline).toContain('catch');
  });
});
