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

const READING_UTILITIES = [
  { name: 'text-source', token: '--text-body', step: 'base' },
  { name: 'text-target', token: '--text-translation', step: 'md' },
] as const;

describe('the reading-scale utilities', () => {
  it.each(READING_UTILITIES)('$name scales $token and nothing else', ({ name, token }) => {
    const body = utility(name);
    const targets = [...body.matchAll(/var\((--[\w-]+)/g)].map((match) => match[1]!);
    // The role token, its line height, and the multiplier. A typo in any of the
    // three is a rule the browser drops silently.
    expect(new Set(targets)).toEqual(new Set([token, `${token}--line-height`, '--reading-scale']));
  });

  it.each(READING_UTILITIES)('$name reads a variable this file declares', ({ name }) => {
    const body = utility(name);
    for (const target of [...body.matchAll(/var\((--[\w-]+)/g)].map((match) => match[1]!)) {
      // `--reading-scale` is written inline by `transcript-panes.tsx`, never here,
      // and the utilities carry its fallback for exactly that reason.
      if (target === '--reading-scale') {
        expect(body).toContain('var(--reading-scale, 1)');
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

  it('leaves the transcript exactly as it was for anyone who never touches it', () => {
    expect(textSizeScale(DEFAULT_TRANSLATE_SETTINGS.textSize)).toBe(1);
  });
});
