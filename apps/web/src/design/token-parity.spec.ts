import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  color,
  elevation,
  fontSize,
  insetField,
  motion,
  palettes,
  radius,
  surfaceEdge,
  type ColorScheme,
} from '@chatofy/ui';

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

/**
 * Every file that carries a copy of the tokens.
 *
 * Two now. `globals.css` was the only one while the web app was the only Tailwind
 * surface; the extension popup is the second, and it needs its own `@theme`
 * because the two cannot share a file — `--font-sans` there resolves through a
 * variable `next/font` injects at render time, and the popup has no Next.
 *
 * Both are hand-written, and that is the point. Emitting them from `tokens.ts`
 * would leave this spec comparing a generator against itself: every assertion
 * below would hold by construction, including the ones that exist to catch a
 * scheme silently pointing at one palette.
 *
 * Reaching across app boundaries to read the second one is deliberate too. One
 * mapping checking both files is the whole mechanism; a second spec next to the
 * second file would be a second table to drift.
 */
const SURFACES = [
  { label: 'apps/web/app/globals.css', path: '../../app/globals.css', scope: 'web' },
  {
    label: 'apps/extension/entrypoints/popup/theme.css',
    path: '../../../extension/entrypoints/popup/theme.css',
    scope: 'popup',
  },
] as const;

type SurfaceScope = (typeof SURFACES)[number]['scope'];

/**
 * Properties ONE surface declares, and which one owns each.
 *
 * Everything else in this file is shared by construction: both surfaces render the
 * same components from `@chatofy/ui/react`, so a token missing from either is a bug.
 * That stops being true the moment a surface has a component the other cannot have.
 *
 * `--text-display` is the first: it is the marketing hero's size, and the popup is a
 * 320px panel hanging off the browser toolbar with no landing page in it. Requiring
 * the popup to declare it would mean carrying a size nothing there ever sets, purely
 * to satisfy a test.
 *
 * **This is not a waiting room.** A token the popup simply has not caught up on is a
 * real divergence and belongs in a comment and an issue, not here. The bar is that
 * the owning surface has the component and the other one structurally cannot.
 *
 * Both directions are enforced below: an owned property missing from its owner fails,
 * and an owned property APPEARING on another surface fails too. Without the second
 * half this table would be a hole rather than a scope.
 */
const SURFACE_ONLY: Record<string, SurfaceScope> = {
  '--text-display': 'web',
};

/** Whether `scope` is allowed to declare `name`. */
const ownsProperty = (name: string, scope: SurfaceScope): boolean =>
  (SURFACE_ONLY[name] ?? scope) === scope;

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
  // Web-only — see SURFACE_ONLY. Listed here so the size is still checked against
  // the token on the surface that does declare it.
  '--text-display': 'display',
};

/** Comments are stripped first: a commented-out declaration is not a declaration. */
const sourceOf = (path: string): string =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  );

/**
 * Variables an alias may reference that this file does not declare.
 *
 * `--font-be-vietnam` is set by `next/font` on the `<html>` element at render
 * time, so it is genuinely absent here. Every other name must be declared in
 * `:root`, or the utility built on it resolves to nothing.
 *
 * The popup has no equivalent: it declares the family literally, because there is
 * no Next there to inject anything. That asymmetry is what the typeface block at
 * the bottom of this file exists to check.
 */
const DECLARED_ELSEWHERE = new Set(['--font-be-vietnam']);

function declarationsIn(source: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of source.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    const [, name, value] = match;
    if (name && value) found.set(name, value.trim());
  }
  return found;
}

function blockIn(source: string, pattern: RegExp, what: string, label: string): string {
  const block = pattern.exec(source)?.[1];
  if (!block) throw new Error(`${label} has no ${what} block — has the file moved?`);
  return block;
}

/**
 * Both halves of one declaration.
 *
 * Each token is written once as `light-dark(light, dark)`, so the value tests read a
 * pair rather than two blocks. That shape is what makes "one scheme silently
 * missing" impossible to express — there is no second block to forget.
 */
function halves(value: string): { light: string; dark: string } | undefined {
  const match = /^light-dark\(\s*([^,]+?)\s*,\s*(.+?)\s*\)$/.exec(value);
  return match ? { light: match[1]!, dark: match[2]! } : undefined;
}

const SCHEMES = ['light', 'dark'] as const satisfies readonly ColorScheme[];

/**
 * Anything that could be a colour, not just `#rrggbb`.
 *
 * The first version of this matched hex only, which made every other notation a
 * silent pass — a colour added as `rgb()`, `oklch()` or `red` would have drifted
 * for as long as nobody looked.
 */
const COLOUR_LIKE =
  /^(#[0-9a-f]{3,8}|(rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color|color-mix|light-dark)\(|(white|black|red|green|blue|orange|yellow|purple|gray|grey)$)/i;

/**
 * Colours that are not palette entries, and the token each one answers to.
 *
 * `MAPPING` above pairs a property with a key of `color`. These have no such key
 * and never will: they are translucent ink and translucent white, so they resolve
 * against whatever they are laid over rather than being a value in their own
 * right, and none of them appears in the contrast table. Without an entry here
 * they would fail "declares no colour the mapping does not account for" — which is
 * the test doing its job, so the answer is to account for them rather than to
 * loosen it.
 */
const EDGE_MAPPING: Record<string, keyof typeof surfaceEdge> = {
  '--surface-hairline': 'hairline',
};

/**
 * Elevation, and why it is not checked with `halves()`.
 *
 * A step is not one `light-dark()` — it is a LIST of shadow layers, each layer's
 * colour wrapped separately, with the layers that belong to the other theme
 * collapsed to `transparent`. It has to be: `light-dark()` is a `<color>`
 * function, so `box-shadow: light-dark(<list>, <list>)` is invalid at computed
 * value time and paints nothing in EITHER theme. Tailwind compiles that form
 * without complaint and every regex here would still pass it, so what this table
 * really guards is that the invalid spelling never comes back.
 *
 * The assertion is therefore per layer: every layer carries a `light-dark()` in
 * its colour position, and every colour that `tokens.ts` names for a step appears
 * among them.
 */
const ELEVATION_MAPPING: Record<string, keyof typeof elevation> = {
  '--elevation-sm': 'sm',
  '--elevation-md': 'md',
  '--elevation-lg': 'lg',
};

/**
 * Every multi-layer shadow token, elevation or not.
 *
 * `--inset-field` is the C1 field recess and is shaped exactly like an elevation
 * step — a layer list per theme — so it is subject to the same two checks: each
 * layer's colour inside its own `light-dark()`, and never the whole list inside
 * one. It is kept OUT of `ELEVATION_MAPPING` for a single reason: an elevation
 * step must have a layer collapsing to `transparent`, and this one must not.
 * Both themes paint both of its layers, because a field is recessed on every
 * ground rather than separated by shadow on one of them.
 *
 * Without this table the `light-dark()` trap below would not reach the newest
 * token that can fall into it — which is the only kind of coverage gap that
 * matters here, since the broken spelling paints nothing and raises nothing.
 */
const SHADOW_MAPPING: Record<string, { light: string; dark: string }> = {
  '--elevation-sm': elevation.sm,
  '--elevation-md': elevation.md,
  '--elevation-lg': elevation.lg,
  '--inset-field': insetField,
};

/** Durations are plain `:root` properties — `--duration-*` is not a Tailwind
 *  namespace, so `@theme` would mint no utility for them. Easing is a namespace
 *  and lives in `@theme inline`, so the two are read from different blocks. */
const DURATION_MAPPING: Record<string, keyof typeof motion.duration> = {
  '--duration-fast': 'fast',
  '--duration-base': 'base',
  '--duration-slow': 'slow',
};

const EASING_MAPPING: Record<string, keyof typeof motion.easing> = {
  '--ease-standard': 'standard',
  '--ease-enter': 'enter',
  '--ease-exit': 'exit',
};

/**
 * The colour slot of each `box-shadow` layer, in declaration order.
 *
 * Depth-counted rather than matched, and that is not tidiness. The first version
 * was a regex whose halves could not span a comma, so it stopped at the first
 * `)` — which is the RIGHT answer only while one half of every layer is
 * `transparent`, as it happens to be for all three elevation steps. Give it a
 * layer with `rgba()` on BOTH sides and it returns the light half plus a stray
 * paren, and the dark colour reads as missing when it is there.
 *
 * `--inset-field` is exactly that layer, which is how this surfaced. Same lesson
 * as `lightDarkPair()` below, one nesting level further out.
 */
function layerColours(value: string): string[] {
  const found: string[] = [];
  const opener = /light-dark\(/g;
  let match: RegExpExecArray | null;
  while ((match = opener.exec(value)) !== null) {
    let depth = 1;
    let end = match.index + match[0].length;
    for (; end < value.length && depth > 0; end += 1) {
      if (value[end] === '(') depth += 1;
      else if (value[end] === ')') depth -= 1;
    }
    found.push(value.slice(match.index, end));
  }
  return found;
}

/**
 * `halves()` for a value whose arguments contain commas of their own.
 *
 * The palette is hex, so the original splits on the first comma and that is
 * correct for every token it reads. These edge colours are `rgba()`, where the
 * first comma is three characters into the first argument — splitting there
 * yields `rgba(19` and an assertion that fails for a reason that has nothing to do
 * with the value being wrong. Depth counting is the difference.
 */
function lightDarkPair(value: string): { light: string; dark: string } | undefined {
  const inner = /^light-dark\(([\s\S]*)\)$/.exec(value.trim())?.[1];
  if (inner === undefined) return undefined;

  let depth = 0;
  for (let i = 0; i < inner.length; i += 1) {
    const c = inner[i];
    if (c === '(') depth += 1;
    else if (c === ')') depth -= 1;
    else if (c === ',' && depth === 0) {
      return { light: inner.slice(0, i).trim(), dark: inner.slice(i + 1).trim() };
    }
  }
  return undefined;
}

describe.each(SURFACES)('$label agrees with @chatofy/ui', ({ label, path, scope }) => {
  const WITHOUT_COMMENTS = sourceOf(path);
  const blockNamed = (pattern: RegExp, what: string) =>
    blockIn(WITHOUT_COMMENTS, pattern, what, label);

  /**
   * Declarations in the `:root` block only.
   *
   * The `@theme inline` block above it declares the same names as `var()`
   * aliases, and matching those would compare a token to `var(--background)`.
   */
  const rootDeclarations = (): Map<string, string> =>
    declarationsIn(blockNamed(/:root\s*\{([\s\S]*?)\n\}/, ':root'));

  const themeAliases = (): Map<string, string> =>
    declarationsIn(blockNamed(/@theme inline\s*\{([\s\S]*?)\n\}/, '@theme inline'));

  const declared = rootDeclarations();

  it.each(
    SCHEMES.flatMap((scheme) =>
      Object.entries(MAPPING).map(([name, key]) => [scheme, name, key] as const),
    ),
  )('%s: %s carries its token value', (scheme, name, key) => {
    const declaration = declared.get(name);
    const pair = halves(declaration ?? '');
    // Named rather than coerced: a token reverted to a bare hex would otherwise
    // compare undefined against a value and fail with nothing pointing at why.
    expect(pair, `${name} is not light-dark(): ${declaration ?? 'absent'}`).toBeDefined();
    expect(pair![scheme].toLowerCase()).toBe(palettes[scheme][key].toLowerCase());
  });

  it('gives both palettes the same keys', () => {
    // A key added to one and forgotten in the other is the failure the pair makes
    // possible, and the type alone does not catch a value left at the wrong scheme.
    expect(Object.keys(palettes.light).sort()).toEqual(Object.keys(palettes.dark).sort());
  });

  it('declares a different value for at least half the properties', () => {
    // Both schemes pointing at one palette is exactly how this shipped before, and
    // every other test here passes in that state.
    const differing = Object.entries(MAPPING).filter(
      ([, key]) => palettes.light[key].toLowerCase() !== palettes.dark[key].toLowerCase(),
    );
    expect(differing.length).toBeGreaterThan(Object.keys(MAPPING).length / 2);
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

  it('declares no colour the mapping does not account for', () => {
    const unmapped = [...declared.entries()]
      .filter(
        ([name, value]) => COLOUR_LIKE.test(value) && !(name in MAPPING) && !(name in EDGE_MAPPING),
      )
      .map(([name]) => name);
    expect(unmapped).toEqual([]);
  });

  it.each(SCHEMES.flatMap((scheme) => Object.keys(EDGE_MAPPING).map((n) => [scheme, n] as const)))(
    '%s: %s carries its surface-edge token value',
    (scheme, name) => {
      const pair = lightDarkPair(declared.get(name) ?? '');
      expect(pair, `${name} is not light-dark(): ${declared.get(name) ?? 'absent'}`).toBeDefined();
      expect(pair![scheme]).toBe(surfaceEdge[EDGE_MAPPING[name]!][scheme]);
    },
  );

  it.each(Object.keys(SHADOW_MAPPING))('%s carries both themes, layer by layer', (name) => {
    const value = declared.get(name);
    expect(value, `${name} is absent from :root`).toBeDefined();

    const layers = layerColours(value!);
    expect(
      layers.length,
      `${name} has no light-dark() layer — a whole-list light-dark() paints nothing in either theme`,
    ).toBeGreaterThan(0);

    // Every layer of the step's own theme must be present, and its colour must sit
    // inside a light-dark() rather than the list being wrapped in one.
    const step = SHADOW_MAPPING[name]!;
    for (const scheme of SCHEMES) {
      for (const colour of step[scheme].matchAll(/rgba?\([^)]*\)/g)) {
        expect(
          layers.some((layer) => layer.includes(colour[0])),
          `${name} is missing the ${scheme} colour ${colour[0]}`,
        ).toBe(true);
      }
    }
  });

  /**
   * Elevation only, and `--inset-field` is deliberately not here.
   *
   * An elevation step separates surfaces in light and leans on luminance in dark,
   * so each theme owns layers the other collapses away — and a step with nothing
   * collapsing is one whose second theme was quietly dropped. A field recess is
   * the opposite: it is cut into every ground in both themes, so a `transparent`
   * layer there would be the bug rather than the proof.
   */
  it.each(Object.keys(ELEVATION_MAPPING))('%s accounts for both themes', (name) => {
    const layers = layerColours(declared.get(name) ?? '');

    // The failure this closes: one theme's layers quietly dropped, leaving the
    // other painting alone and the surface flat on half the machines.
    const collapsed = layers.filter((layer) => layer.includes('transparent'));
    expect(
      collapsed.length,
      `${name} has no layer collapsing to transparent — one theme is unaccounted for`,
    ).toBeGreaterThan(0);
  });

  it('never wraps a whole shadow list in light-dark()', () => {
    // `box-shadow: light-dark(<list>, <list>)` is invalid at computed value time
    // and resolves to `none` in BOTH themes, with no error from CSS, from Tailwind,
    // or from any other assertion in this file. Measured in Chromium.
    const wrapped = Object.keys(SHADOW_MAPPING).filter((name) =>
      /^light-dark\(/.test(declared.get(name) ?? ''),
    );
    expect(wrapped).toEqual([]);
  });

  it.each(Object.entries(DURATION_MAPPING))('%s carries its token value', (name, key) => {
    expect(declared.get(name)).toBe(`${motion.duration[key]}ms`);
  });

  it.each(Object.entries(EASING_MAPPING))('%s carries its token value', (name, key) => {
    // Easing sits in `@theme inline`, not `:root`: `--ease-*` is a Tailwind theme
    // namespace and mints `ease-standard` from there. `--duration-*` is not a
    // namespace, which is why the two are read from different blocks.
    expect(themeAliases().get(name)).toBe(motion.easing[key]);
  });

  it('declares every mapped property', () => {
    const missing = Object.keys(MAPPING).filter((name) => !declared.has(name));
    expect(missing).toEqual([]);
  });

  it('gives every mapped property both halves', () => {
    // The failure this closes: one token quietly reverted to a single value, which
    // renders one scheme correctly and the other on the wrong ground.
    const single = Object.keys(MAPPING).filter((name) => !halves(declared.get(name) ?? ''));
    expect(single).toEqual([]);
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
      // A step this surface does not own is checked on its owner instead — and the
      // test below proves it is genuinely absent here rather than merely unread.
      if (!ownsProperty(name, scope)) continue;
      const value = aliases.get(name);
      const match = /^(\d+)px$/.exec(value ?? '');
      if (!match) throw new Error(`${name} is not Npx: ${value ?? 'absent'}`);
      expect(Number.parseInt(match[1]!, 10)).toBe(fontSize[step]);
    }
  });

  /**
   * The other half of `SURFACE_ONLY`, without which it is a hole rather than a scope.
   *
   * Skipping an unowned property in the tests above means a stray `--text-display`
   * in the popup would be read by nothing. That is exactly the drift this file
   * exists to catch, so the escape hatch has to be policed from both ends: owned
   * here, and absent everywhere else.
   */
  it('declares no property another surface owns', () => {
    /**
     * The WHOLE FILE, not `:root` and the first `@theme inline` block.
     *
     * Every other test here reads a specific block, which is right when checking
     * that a value is correct. It is wrong for a trespass check, and there are
     * three places a stray declaration would otherwise hide — all of them live in
     * the browser and invisible to a block-scoped read:
     *
     * 1. a SECOND `@theme inline` block. `themeAliases()` matches non-greedily and
     *    reads only the first; Tailwind merges them. The type-scale test above
     *    already confesses to this blind spot.
     * 2. a plain `@theme { }` with no `inline`. Both block regexes require the
     *    literal `@theme inline`; Tailwind accepts either.
     * 3. anywhere else at all — `@layer base`, a media query, an arbitrary
     *    selector. No utility is minted, but the property is set and any
     *    `var(--text-display)` resolves against it.
     *
     * A whole-file name scan is strictly stronger and closes all three at once.
     * It can only over-report, and over-reporting a property that genuinely
     * belongs to another surface is the answer this test wants.
     */
    const anywhere = declarationsIn(WITHOUT_COMMENTS);
    const trespassing = Object.keys(SURFACE_ONLY).filter(
      (name) => !ownsProperty(name, scope) && anywhere.has(name),
    );
    expect(
      trespassing,
      `${label} declares a property owned by another surface — either it is no longer surface-only, or it was pasted here by mistake`,
    ).toEqual([]);
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
      (name) => ownsProperty(name, scope) && !aliases.has(`${name}--line-height`),
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

/**
 * One typeface on both surfaces — and the only form that claim can take as a test.
 *
 * The two get there by different routes and neither route produces a string the
 * other can be compared against. `next/font` mints a build-time hashed family
 * (`__Be_Vietnam_Pro_<hash>`) that appears in no source file; the popup declares
 * `@font-face` by hand from woff2 it ships. So the shared anchor is the FAMILY
 * NAME below, and each surface is checked for reaching it — web through the
 * `next/font` call whose export name IS the family with underscores for spaces,
 * the popup through the literal.
 *
 * A family token in `tokens.ts` would have been the obvious alternative and is
 * wrong: it would push a DOM font name onto the root entry `apps/mobile` imports,
 * where it means nothing.
 *
 * Runtime equality of the RENDERED face is not checkable from here and is
 * confirmed once per surface in devtools. What this block prevents is the drift
 * that happens silently — one surface's weights changed, a file renamed, a
 * fallback tail dropped so a failed load lands on nothing.
 */
const FONT_FAMILY = 'Be Vietnam Pro';

/** What a failed `@font-face` must land on. Both surfaces carry it. */
const FALLBACK_TAIL = ['ui-sans-serif', 'system-ui', 'sans-serif'];

/** Body, control label, heading, and nothing heavier. */
const FONT_WEIGHTS = ['400', '500', '600', '700'];

const LAYOUT = '../../app/layout.tsx';
const POPUP_FONT_DIR = '../../../extension/public';

/** `--font-sans` split on top-level commas: the family, then the fallbacks. */
function fontStack(source: string, label: string): string[] {
  const block = blockIn(source, /@theme inline\s*\{([\s\S]*?)\n\}/, '@theme inline', label);
  const declaration = declarationsIn(block).get('--font-sans');
  if (!declaration) throw new Error(`${label} declares no --font-sans`);
  return declaration.split(',').map((segment) => segment.trim());
}

describe('both surfaces resolve one typeface', () => {
  it.each(SURFACES)('$label keeps a fallback tail behind the family', ({ label, path }) => {
    const [family, ...tail] = fontStack(sourceOf(path), label);
    expect(family, `${label} declares no family segment`).toBeTruthy();
    // The failure this closes: a font file dropped from the package, or a subset
    // rebuilt wrong, leaving the surface with no family to fall back to at all.
    expect(tail, `${label} lost its fallback tail`).toEqual(FALLBACK_TAIL);
  });

  it('web reaches the family through next/font', () => {
    const layout = sourceOf(LAYOUT).replace(/^\s*\/\/.*$/gm, '');

    // The export name IS the family: `Be_Vietnam_Pro` with underscores for
    // spaces. That is the whole tie between this surface and the constant above.
    const called = /(\w+)\(\{/.exec(/from 'next\/font\/google';([\s\S]*)/.exec(layout)?.[1] ?? '');
    expect(called?.[1]?.replace(/_/g, ' '), 'layout.tsx loads a different family').toBe(
      FONT_FAMILY,
    );

    // `--font-sans` must go through the variable next/font sets, never name the
    // family itself — the hashed family is the only one that resolves to the
    // self-hosted files.
    const [family] = fontStack(sourceOf(SURFACES[0].path), SURFACES[0].label);
    const variable = /variable:\s*'(--[\w-]+)'/.exec(layout)?.[1];
    expect(variable, 'layout.tsx sets no font variable').toBeTruthy();
    expect(family).toBe(`var(${variable})`);

    // Static family: omitting `weight` fails the build outright, so what this
    // guards is the set drifting from the popup's, which fails silently — a
    // weight web has and the popup does not is synthesised by the browser.
    const weights = [...(/weight:\s*\[([^\]]*)\]/.exec(layout)?.[1] ?? '').matchAll(/'(\d+)'/g)];
    expect(weights.map((m) => m[1])).toEqual(FONT_WEIGHTS);
  });

  it('the popup ships the family itself', () => {
    const popup = SURFACES[1];
    const source = sourceOf(popup.path);

    const [family = ''] = fontStack(source, popup.label);
    expect(family.replace(/['"]/g, ''), 'the popup names a different family').toBe(FONT_FAMILY);

    const faces = [...source.matchAll(/@font-face\s*\{([\s\S]*?)\}/g)].map((match) => {
      const body = match[1] ?? '';
      return {
        family: (/font-family:\s*([^;]+);/.exec(body)?.[1] ?? '').replace(/['"]/g, '').trim(),
        weight: /font-weight:\s*(\d+);/.exec(body)?.[1],
        url: /url\('([^']+)'\)/.exec(body)?.[1],
        display: /font-display:\s*(\w+);/.exec(body)?.[1],
      };
    });

    expect(faces.map((face) => face.weight)).toEqual(FONT_WEIGHTS);
    expect(faces.every((face) => face.family === FONT_FAMILY)).toBe(true);
    // Web is `display: 'swap'`; a blocking face here would show an empty pane for
    // most of the popup's life.
    expect(faces.every((face) => face.display === 'swap')).toBe(true);

    // The 404 the comment beside those rules warns about. Nothing else catches
    // it: a missing file renders the fallback tail, which looks like a font that
    // simply is not this one.
    const missing = faces
      .map((face) => face.url ?? '')
      .filter(
        (url) => !existsSync(fileURLToPath(new URL(`${POPUP_FONT_DIR}${url}`, import.meta.url))),
      );
    expect(missing, 'these @font-face files are not in apps/extension/public').toEqual([]);
  });
});
