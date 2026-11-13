// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { PREFERENCES_CACHE_KEY } from './preferences/preferences-cache';
import { PRE_PAINT_THEME_SCRIPT, applyChoice } from './theme';

/**
 * The blocking script, run for real against the cache it reads.
 *
 * It runs before any module loads, so it cannot import the key it reads — it is a
 * string built from the constant at render time. These run that string, so a
 * rename on either side, or a change to the cache's shape, fails here instead of
 * silently bringing back the flash on reload.
 */
// `node:path` rather than `new URL(…, import.meta.url)`: happy-dom replaces the
// global `URL`, and its constructor yields a URL `fileURLToPath` refuses.
const LAYOUT = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../app/layout.tsx'),
  'utf8',
);

function runScript(): void {
  // Evaluating the inline string is the point: it is what the browser runs.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, @typescript-eslint/no-unsafe-call
  new Function(PRE_PAINT_THEME_SCRIPT)();
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = '';
});

describe('the blocking theme script', () => {
  it('paints the cached theme of a signed-in reader', () => {
    localStorage.setItem(
      PREFERENCES_CACHE_KEY,
      JSON.stringify({ userId: 'u1', preferences: { theme: 'dark', voices: {} } }),
    );
    runScript();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it("paints a signed-out visitor's theme", () => {
    localStorage.setItem(
      PREFERENCES_CACHE_KEY,
      JSON.stringify({ userId: null, preferences: { theme: 'light' } }),
    );
    runScript();
    expect(document.documentElement.classList.contains('light')).toBe(true);
  });

  it('leaves the machine to decide under system, an unknown value, or no cache', () => {
    for (const value of [
      null,
      '{not json',
      JSON.stringify({ userId: 'u1', preferences: { theme: 'system' } }),
      JSON.stringify({ userId: 'u1', preferences: { theme: 'sepia' } }),
      JSON.stringify({ userId: 'u1' }),
    ]) {
      localStorage.clear();
      if (value !== null) localStorage.setItem(PREFERENCES_CACHE_KEY, value);
      expect(() => runScript()).not.toThrow();
      expect(document.documentElement.className).toBe('');
    }
  });

  it('is the script the layout renders, before the body', () => {
    // Below <body> it is no longer a blocking script, and the flash it exists to
    // prevent comes back with nothing failing.
    const head = LAYOUT.indexOf('<head>');
    const body = LAYOUT.indexOf('<body>');
    const script = LAYOUT.indexOf('PRE_PAINT_THEME_SCRIPT }}');
    expect(head).toBeGreaterThan(-1);
    expect(script).toBeGreaterThan(head);
    expect(script).toBeLessThan(body);
  });

  it('keeps the attribute React did not write from being reported', () => {
    expect(LAYOUT).toContain('suppressHydrationWarning');
  });
});

describe('applyChoice', () => {
  it('holds at most one theme class, and none under system', () => {
    applyChoice('dark');
    applyChoice('light');
    expect(document.documentElement.className).toBe('light');
    applyChoice('system');
    expect(document.documentElement.className).toBe('');
  });
});
