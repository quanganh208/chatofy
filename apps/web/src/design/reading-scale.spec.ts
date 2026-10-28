import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { fontSize } from '@chatofy/ui';
import { DEFAULT_TRANSLATE_SETTINGS, textSizeScale } from '@/lib/translate-settings';

/**
 * The two utilities the reader's text-size control drives, and the one thing no
 * other spec here can see.
 *
 * `token-parity.spec.ts` reads DECLARATIONS — `(--[\w-]+)\s*:` — so an `@utility`
 * block that declares no custom property of its own is invisible to every scan in
 * that file, in both directions. `app-skin-guard.spec.ts` bans size NAMES and
 * arbitrary px in TSX and never opens the stylesheet. So `font-size: calc(var(
 * --text-bodyy) * var(--reading-scale, 1))` would compile, ship a `font-size` the
 * browser discards, and pass all 176 parity assertions plus every skin ban.
 *
 * That is the gap this closes: the `var()` TARGETS inside the calc must be
 * variables this stylesheet actually declares.
 */

const css = readFileSync(fileURLToPath(new URL('../../app/globals.css', import.meta.url)), 'utf8');

/** Comments stripped first: a commented-out declaration is not a declaration. */
const source = css.replace(/\/\*[\s\S]*?\*\//g, '');

function utility(name: string): string {
  const match = new RegExp(`@utility\\s+${name}\\s*\\{([^}]*)\\}`).exec(source);
  if (!match) throw new Error(`@utility ${name} is not declared`);
  return match[1]!;
}

/**
 * The variables written INLINE — by `readingStyle` in `reading-appearance.ts`, on
 * the one element above the transcript — and therefore never declared here. Each
 * must be read with the fallback that IS the old look, because the default
 * appearance writes none of them and `/history` never writes any.
 */
const INLINE_FALLBACKS: Record<string, string> = {
  '--reading-scale': '1',
  '--reading-leading': '1',
  '--reading-font': 'inherit',
};

const READING_UTILITIES = [
  { name: 'text-source', token: '--text-body', step: 'base' },
  { name: 'text-target', token: '--text-translation', step: 'md' },
] as const;

describe('the reading-scale utilities', () => {
  it.each(READING_UTILITIES)('$name scales $token and nothing else', ({ name, token }) => {
    const body = utility(name);
    const targets = [...body.matchAll(/var\((--[\w-]+)/g)].map((match) => match[1]!);
    // The role token, its line height, the multiplier, and the reader's leading
    // and face. A typo in any of them is a rule the browser drops silently.
    expect(new Set(targets)).toEqual(
      new Set([
        token,
        `${token}--line-height`,
        '--reading-scale',
        '--reading-leading',
        '--reading-font',
      ]),
    );
  });

  it.each(READING_UTILITIES)('$name reads a variable this file declares', ({ name }) => {
    const body = utility(name);
    for (const target of [...body.matchAll(/var\((--[\w-]+)/g)].map((match) => match[1]!)) {
      // Written inline, never here, so the utilities carry the fallback instead.
      const fallback = INLINE_FALLBACKS[target];
      if (fallback !== undefined) {
        expect(body).toContain(`var(${target}, ${fallback})`);
        continue;
      }
      expect(source).toContain(`${target}:`);
    }
  });

  it.each(READING_UTILITIES)(
    '$name is built on the shared scale, not beside it',
    ({ token, step }) => {
      // The whole reason these are multipliers: the two sizes and the RATIO between
      // them stay owned by `tokens.ts`, so the translation cannot stop being the
      // larger of the two at some step nobody looked at.
      const declared = new RegExp(`${token}:\\s*(\\d+)px`).exec(source);
      expect(declared?.[1]).toBe(String(fontSize[step]));
    },
  );

  it.each([
    ['reading-source', '--reading-source', 'var(--prose)'],
    ['reading-target', '--reading-target', 'inherit'],
    ['reading-target', '--reading-target-weight', '500'],
    ['reading-time', '--reading-time', 'var(--muted-foreground)'],
    ['reading-turn', '--reading-align', 'start'],
    ['reading-meta', '--reading-align', 'normal'],
    ['reading-frame', '--reading-bg', 'transparent'],
  ])('%s reads %s with the old look as its fallback', (name, variable, fallback) => {
    expect(utility(name)).toContain(`var(${variable}, ${fallback})`);
  });

  it('re-declares the ink on the frame, so a forced scheme reaches inherited text', () => {
    // `light-dark()` resolves where `color` is declared. Inherited from `body`, it
    // arrives already resolved in the page's scheme — default text on a black
    // ground would stay the light theme's near-black.
    expect(utility('reading-frame')).toContain('color: var(--foreground)');
  });

  it('re-declares every token on the scheme islands, from the one block', () => {
    // The tokens resolve where they are declared, so an island the block does
    // not name would keep the page's scheme whatever `color-scheme` says.
    expect(source).toMatch(/:root,\s*\.reading-scheme-light,\s*\.reading-scheme-dark\s*\{/);
    expect(source).toMatch(/\.reading-scheme-dark\s*\{\s*color-scheme:\s*dark;/);
    expect(source).toMatch(/\.reading-scheme-light\s*\{\s*color-scheme:\s*light;/);
  });

  it('leaves the transcript exactly as it was for anyone who never touches it', () => {
    expect(textSizeScale(DEFAULT_TRANSLATE_SETTINGS.textSize)).toBe(1);
  });
});
