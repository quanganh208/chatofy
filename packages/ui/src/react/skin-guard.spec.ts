import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The re-skin rules, held in place after the fact.
 *
 * Every component here arrived from `shadcn add` and was rewritten to this
 * project's tokens. That rewrite is mechanical, which means the next person to
 * run `add` will produce a file that needs the same pass — and a file that
 * skipped it does not fail to compile, does not fail to render, and does not
 * look obviously wrong in the one theme its author happened to be using.
 *
 * Comments are stripped first, and that is not a detail. This file's siblings
 * explain the rules by naming the very patterns forbidden below; matching prose
 * would make every correctly re-skinned component fail. The same mistake would
 * have made `popup-style.spec.ts` unusable, which is where the habit comes from.
 */

const dir = fileURLToPath(new URL('.', import.meta.url));

const SOURCES = readdirSync(dir)
  .filter((name) => name.endsWith('.tsx') && !name.endsWith('.spec.tsx'))
  .map((name) => {
    const withoutComments = readFileSync(`${dir}${name}`, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    return { name, source: withoutComments };
  });

/** [what it matches, why it is banned]. */
const FORBIDDEN: ReadonlyArray<{ pattern: RegExp; rule: string }> = [
  {
    // Any `dark:` utility, including one behind another variant.
    pattern: /(?:^|[\s"'`:])(?:[\w\-[\]]+:)*dark:/m,
    rule:
      'this palette is light-dark() based and the theme class is absent under "follow the ' +
      'machine", so a dark: utility never fires while every token still flips — it renders ' +
      'the light treatment on a dark ground for most people, silently',
  },
  {
    // Bare `bg-accent`, not the product's `bg-accent-hover`/`-subtle`/`-text`.
    pattern: /\bbg-accent(?![-\w])/,
    rule: 'shadcn\'s --accent is a pale grey hover surface; here "accent" is the brand blue, and there is no bare --accent token. Use bg-secondary',
  },
  {
    pattern: /\btext-accent-foreground\b/,
    rule: 'same collision as bg-accent. Use text-foreground',
  },
  {
    pattern: /\bbg-popover(?![-\w])|\btext-popover-foreground\b/,
    rule: 'no --popover token exists. Use bg-card / text-card-foreground',
  },
  {
    pattern: /\bborder-input(?![-\w])/,
    rule: 'the control border token here is --border-control',
  },
  {
    pattern: /\btext-sm\b|\btext-xs\b/,
    rule:
      "the type scale is by role, not by size name — text-body and text-hint. Tailwind's own " +
      "text-sm is 14px against this project's 12, so the two do not mean the same thing",
  },
  {
    pattern: /from '@\/lib\/utils'/,
    rule: 'the CLI writes this alias, but rollup-plugin-dts does not apply tsconfig paths — the JS builds pass and only the types fail. Use a relative import',
  },
];

describe('generated components are re-skinned', () => {
  it('reads every component in the entry', () => {
    // A floor. Every assertion below passes over an empty list.
    expect(SOURCES.length).toBeGreaterThan(10);
  });

  for (const { pattern, rule } of FORBIDDEN) {
    it(`has no ${pattern.source}`, () => {
      const offenders = SOURCES.filter(({ source }) => pattern.test(source)).map(
        ({ name }) => name,
      );
      expect(offenders, rule).toEqual([]);
    });
  }
});
