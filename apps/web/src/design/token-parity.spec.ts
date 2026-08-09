import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { color, radius } from '@chatofy/ui';

/**
 * The sync mechanism between `packages/ui/src/tokens.ts` and `app/globals.css`.
 *
 * Tailwind's `@theme` needs real CSS and cannot import TypeScript, so the brand
 * values are written in both places. Rather than generate one from the other —
 * a build step nobody would maintain for fifteen values — the two are compared
 * here, and the comparison is a hand-written table.
 *
 * The table is deliberately hand-written. An inferred mapping (strip the prefix,
 * camel-case the rest) would pass while mapping the wrong things to each other,
 * which is the one failure this test exists to prevent.
 *
 * Both directions are asserted. Only checking that every token appears in the CSS
 * would let an unmapped colour be added to `globals.css` and drift forever.
 */

const CSS = readFileSync(fileURLToPath(new URL('../../app/globals.css', import.meta.url)), 'utf8');

/** CSS custom property -> the token whose value it must carry. */
const MAPPING: Record<string, string> = {
  '--background': color.bg,
  '--foreground': color.text,
  '--card': color.surface,
  '--card-foreground': color.text,
  '--muted': color.surfaceRaised,
  '--muted-foreground': color.textMuted,
  '--secondary': color.surfaceRaised,
  '--secondary-foreground': color.text,
  '--primary': color.accent,
  '--primary-foreground': color.onAccent,
  '--accent-hover': color.accentHover,
  '--accent-text': color.accentText,
  '--accent-subtle': color.accentSubtle,
  // Same value as `--live` today, different meaning. See globals.css.
  '--destructive': color.live,
  // Dark, like every other ink on a fill bright enough to need it. It reads 4.99
  // on `--destructive`, where the white it replaced read 3.91.
  '--destructive-foreground': color.onAccent,
  '--live': color.live,
  '--live-fill': color.liveFill,
  '--on-live-fill': color.onLiveFill,
  '--live-subtle': color.liveSubtle,
  '--speaking': color.speaking,
  '--warning': color.warning,
  '--warning-subtle': color.warningSubtle,
  '--border': color.border,
  '--border-control': color.borderControl,
  '--input': color.borderControl,
  '--ring': color.accentText,
};

/** Comments are stripped first: a commented-out declaration is not a declaration. */
const WITHOUT_COMMENTS = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * Variables an alias may reference that this file does not declare.
 *
 * `--font-inter` is set by `next/font` on the `<html>` element at render time, so
 * it is genuinely absent here. Every other name must be declared in `:root`, or
 * the utility built on it resolves to nothing.
 */
const DECLARED_ELSEWHERE = new Set(['--font-inter']);

function declarationsIn(source: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of source.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    const [, name, value] = match;
    if (name && value) found.set(name, value.trim());
  }
  return found;
}

function blockNamed(pattern: RegExp, what: string): string {
  const block = pattern.exec(WITHOUT_COMMENTS)?.[1];
  if (!block) throw new Error(`globals.css has no ${what} block — has the file moved?`);
  return block;
}

/**
 * Declarations in the `:root` block only.
 *
 * The `@theme inline` block above it declares the same names as `var()` aliases,
 * and matching those would compare a token to the string `var(--background)`.
 */
const rootDeclarations = (): Map<string, string> =>
  declarationsIn(blockNamed(/:root\s*\{([\s\S]*?)\n\}/, ':root'));

const themeAliases = (): Map<string, string> =>
  declarationsIn(blockNamed(/@theme inline\s*\{([\s\S]*?)\n\}/, '@theme inline'));

/**
 * Anything that could be a colour, not just `#rrggbb`.
 *
 * The first version of this matched hex only, which made every other notation a
 * silent pass — a colour added as `rgb()`, `oklch()` or `red` would have drifted
 * for as long as nobody looked.
 */
const COLOUR_LIKE =
  /^(#[0-9a-f]{3,8}|(rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color|color-mix)\(|(white|black|red|green|blue|orange|yellow|purple|gray|grey)$)/i;

describe('globals.css agrees with @chatofy/ui', () => {
  const declared = rootDeclarations();

  it.each(Object.entries(MAPPING))('%s carries its token value', (name, expected) => {
    expect(declared.get(name)?.toLowerCase()).toBe(expected.toLowerCase());
  });

  it('has no colour in :root that the mapping does not account for', () => {
    const unmapped = [...declared.entries()]
      .filter(([name, value]) => COLOUR_LIKE.test(value) && !(name in MAPPING))
      .map(([name]) => name);
    expect(unmapped).toEqual([]);
  });

  it('declares every mapped property', () => {
    const missing = Object.keys(MAPPING).filter((name) => !declared.has(name));
    expect(missing).toEqual([]);
  });

  it('has no colour declared outside :root', () => {
    // A value added straight into `@theme inline`, or into `@layer base`, would
    // never reach the mapping above — the block this test reads is not the whole
    // file. Aliases are `var()` references and are checked separately below.
    const outside = [
      ...declarationsIn(
        WITHOUT_COMMENTS.replace(blockNamed(/:root\s*\{([\s\S]*?)\n\}/, ':root'), ''),
      ).entries(),
    ]
      .filter(([, value]) => COLOUR_LIKE.test(value))
      .map(([name]) => name);
    expect(outside).toEqual([]);
  });

  it('has no @theme alias pointing at a variable that does not exist', () => {
    // `--color-accent-text: var(--acccent-text)` typechecks, builds, and ships a
    // utility that resolves to nothing. Only this catches it.
    const dangling = [...themeAliases().entries()]
      .flatMap(([alias, value]) =>
        [...value.matchAll(/var\((--[\w-]+)\)/g)].map((m) => [alias, m[1]!] as const),
      )
      .filter(([, target]) => !declared.has(target) && !DECLARED_ELSEWHERE.has(target))
      .map(([alias, target]) => `${alias} -> ${target}`);
    expect(dangling).toEqual([]);
  });

  /**
   * The offsets are read out of the CSS, not restated here.
   *
   * The first version asserted `lg - 4 === radius.md` and `lg - 8 === radius.sm`,
   * which is arithmetic on the token module — it never opened the `calc()` it
   * claimed to be checking. Reverting `@theme inline` to shadcn's original
   * `- 2px` / `- 4px` left the whole suite green while `rounded-[var(--radius-md)]`
   * rendered at 12px against a token that says 10.
   */
  it('keeps the radius scale in step with the tokens', () => {
    const lg = Number.parseInt(declared.get('--radius') ?? '', 10);
    expect(lg).toBe(radius.lg);

    const aliases = themeAliases();
    const offsetOf = (name: string): number => {
      const value = aliases.get(name);
      // `calc(var(--radius) - 4px)`. Anything else — a literal, a different base
      // variable — is a shape this test cannot vouch for, so it fails rather than
      // silently reading zero out of a failed match.
      const match = /^calc\(\s*var\(--radius\)\s*-\s*(\d+)px\s*\)$/.exec(value ?? '');
      if (!match) throw new Error(`${name} is not calc(var(--radius) - Npx): ${value ?? 'absent'}`);
      return Number.parseInt(match[1]!, 10);
    };

    expect(lg - offsetOf('--radius-md')).toBe(radius.md);
    expect(lg - offsetOf('--radius-sm')).toBe(radius.sm);
  });
});
