import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { color, fontSize, radius } from '@chatofy/ui';

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

/**
 * CSS custom property -> the *token key* whose value it must carry.
 *
 * Keys, not values, and that is load-bearing. The table used to hold values
 * (`'--background': color.bg`), which made a coverage check impossible to write
 * honestly: with no key recorded, "is every token mapped?" can only be asked as
 * value inclusion, and value inclusion passes for any new token whose hex happens
 * to duplicate one already here. Two pairs collide today — `onAccent` is the same
 * `#0C0C0E` as `bg`, and `destructive` carries `live` — so that check would have
 * been satisfied by coincidence rather than by coverage.
 *
 * This is coverage, not uniqueness: `--destructive`/`--live` both map to `live`,
 * and `--input`/`--border-control` both to `borderControl`. Both are intended.
 */
const MAPPING: Record<string, keyof typeof color> = {
  '--background': 'bg',
  '--foreground': 'text',
  '--card': 'surface',
  '--card-foreground': 'text',
  '--muted': 'surfaceRaised',
  '--muted-foreground': 'textMuted',
  // Supporting prose — the step between `--foreground` (16.83) and
  // `--muted-foreground` (5.92). Named `--prose` rather than `--text-secondary`
  // because `--color-secondary` already exists and Tailwind therefore already
  // generates a `text-secondary` utility, which resolves to `surfaceRaised` —
  // near-black on a near-black ground. Two utilities one prefix apart, one of them
  // invisible, is not a distinction to leave lying around.
  '--prose': 'textSecondary',
  '--secondary': 'surfaceRaised',
  '--secondary-foreground': 'text',
  '--primary': 'accent',
  '--primary-foreground': 'onAccent',
  '--accent-hover': 'accentHover',
  '--accent-text': 'accentText',
  '--accent-subtle': 'accentSubtle',
  // Same value as `--live` today, different meaning. See globals.css.
  '--destructive': 'live',
  // Dark, like every other ink on a fill bright enough to need it. It reads 4.99
  // on `--destructive`, where the white it replaced read 3.91.
  '--destructive-foreground': 'onAccent',
  '--live': 'live',
  '--live-fill': 'liveFill',
  '--on-live-fill': 'onLiveFill',
  '--live-subtle': 'liveSubtle',
  '--speaking': 'speaking',
  '--warning': 'warning',
  '--warning-subtle': 'warningSubtle',
  '--border': 'border',
  '--border-strong': 'borderStrong',
  '--border-control': 'borderControl',
  '--input': 'borderControl',
  '--ring': 'accentText',
};

/**
 * CSS custom property -> the `fontSize` step it must carry.
 *
 * Role names rather than `xs…xl`, and that is not cosmetic. Adding `--text-xs`
 * through `--text-xl` to `@theme` overrides Tailwind's own utilities of those
 * names at different values (token `sm` is 12 against Tailwind's 14, `lg` is 22
 * against 18), so it would silently re-typeset every existing `text-sm` and
 * `text-lg` in the app in one commit. Role names collide with nothing and carry
 * the meaning the guidelines' own Role column already assigns.
 */
const TYPE_MAPPING: Record<string, keyof typeof fontSize> = {
  '--text-label': 'xs',
  '--text-hint': 'sm',
  '--text-body': 'base',
  '--text-translation': 'md',
  '--text-heading': 'lg',
  '--text-title': 'xl',
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

  it.each(Object.entries(MAPPING))('%s carries its token value', (name, key) => {
    expect(declared.get(name)?.toLowerCase()).toBe(color[key].toLowerCase());
  });

  /**
   * The direction that was missing, and the reason two tokens never reached web.
   *
   * The checks around this one all start from the CSS: they catch a colour declared
   * in `globals.css` that the table forgot, and a mapped property the CSS forgot to
   * declare. Neither can see a token that exists in `packages/ui` and appears in
   * *neither* place — which is exactly what happened to `borderStrong` and
   * `textSecondary`. They sat in the token module, absent from the CSS and absent
   * from this table, and every test here passed.
   *
   * `textSecondary` is the step the guidelines assign to "the source transcript,
   * supporting prose". Without it every non-heading string on web had to be
   * `--foreground` at 16.83 or `--muted-foreground` at 5.92 — shouting or nearly
   * disabled, with nothing in between — while the extension rendered the middle
   * step. That is why web read flatter than the extension, and it was a plumbing
   * gap rather than a design choice.
   */
  it('maps every colour token', () => {
    const mapped = new Set<keyof typeof color>(Object.values(MAPPING));
    const unmapped = (Object.keys(color) as (keyof typeof color)[]).filter(
      (key) => !mapped.has(key),
    );
    expect(unmapped).toEqual([]);
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

  /**
   * The type scale, read out of the CSS and compared against the token module.
   *
   * Same discipline as the radius test above: the numbers are not restated here.
   * `docs/design-guidelines.md` used to record web's type scale as a known
   * divergence — Tailwind's own steps plus a few literals, because no `--text-*`
   * entries existed in `@theme`. This closes it.
   *
   * The entries must live inside the *existing* `@theme inline` block.
   * `themeAliases()` matches non-greedily and reads only the first such block, so a
   * second `@theme inline { … }` renders correctly (Tailwind merges them) while this
   * test reports the whole scale absent.
   */
  it('keeps the type scale in step with the tokens', () => {
    const aliases = themeAliases();
    for (const [name, step] of Object.entries(TYPE_MAPPING)) {
      const value = aliases.get(name);
      const match = /^(\d+)px$/.exec(value ?? '');
      if (!match) throw new Error(`${name} is not Npx: ${value ?? 'absent'}`);
      expect(Number.parseInt(match[1]!, 10)).toBe(fontSize[step]);
    }
  });

  /**
   * Every size step pairs with a line-height, because half a pair is worse than none.
   *
   * Tailwind's own size utilities ship a `--line-height` companion. One declared
   * without it emits font-size alone and the element falls back to the inherited
   * 1.5 — so `text-title` would render 28px at line-height 42. Nothing else here
   * would notice: the scale test above only reads the size, and no grep can see a
   * line-height that was never written.
   */
  it('pairs every type step with a line-height', () => {
    const aliases = themeAliases();
    const missing = Object.keys(TYPE_MAPPING).filter(
      (name) => !aliases.has(`${name}--line-height`),
    );
    expect(missing).toEqual([]);
  });

  /**
   * The next link in the chain that "never reached web" broke at.
   *
   * A `:root` declaration only becomes a utility by way of a `@theme` alias. Delete
   * `--color-prose: var(--prose)` and every other test here still passes — the token
   * is declared, mapped and correct — while `text-prose` quietly stops existing.
   * Verified by doing exactly that: 55/55 green with the utility gone. This closes
   * the same class of gap as `maps every colour token`, one step further along.
   */
  it('exposes every mapped colour as a @theme alias', () => {
    const aliasTargets = new Set(
      [...themeAliases().values()].flatMap((value) =>
        [...value.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]!),
      ),
    );
    const unexposed = Object.keys(MAPPING).filter((name) => !aliasTargets.has(name));
    expect(unexposed).toEqual([]);
  });

  /**
   * The naming trap that made `--text-secondary` unusable.
   *
   * `--color-secondary` already exists, so Tailwind already generates a
   * `text-secondary` text-colour utility — and it resolves to `surfaceRaised`,
   * near-black on a near-black ground. Had the supporting-prose token been called
   * `--text-secondary`, its utility would have been `text-text-secondary`: one
   * prefix away from an invisible one, with nothing to tell them apart at a call
   * site. This test keeps the trap from being reintroduced by a later tidy-up.
   */
  it('does not declare a text token whose utility collides with an existing one', () => {
    expect(declared.has('--text-secondary')).toBe(false);
  });
});
