import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The re-skin rules, applied to the APP surfaces.
 *
 * `packages/ui/src/react/skin-guard.spec.ts` holds the shared components to
 * these. Nothing held the apps, which is how `text-2xl` survived in
 * `app/login/page.tsx` — the single place in the codebase using a size name
 * instead of a role token — for as long as it did.
 *
 * ## Why it lives here and not beside the other one
 *
 * Extending the package's spec to read `apps/` by relative path would invert the
 * dependency direction: a shared package's test would fail because of an app that
 * does not exist in another checkout. `apps/web/src/design/` already reaches
 * across app boundaries on purpose — `token-parity.spec.ts` reads the extension's
 * stylesheet from here, and records why — so this is the established place for a
 * check that spans surfaces.
 *
 * ## Three ways this could have passed while checking nothing
 *
 * All three were real, and each is guarded rather than trusted:
 *
 * 1. **A non-recursive walk.** The mechanism next door is a flat `readdirSync`,
 *    correct there because that package keeps every component in one directory.
 *    Reused here it would scan almost nothing: `apps/web/src` has ZERO top-level
 *    `.tsx`, and the file this guard exists to have caught sits two levels down.
 * 2. **A floor that one root can satisfy for all of them.** A single
 *    `expect(files.length).toBeGreaterThan(10)` is met by any one busy root while
 *    another resolves to an empty list — a root that scanned nothing reads
 *    exactly like a root that was clean. Each root is counted separately below.
 * 3. **A pattern that misses the violation.** The package's ban is
 *    `text-sm|text-xs`, which does not match `text-2xl`. Widened here to the
 *    whole size-name family and to `text-[16px]`-style arbitrary values, so
 *    "stop using size names" cannot be satisfied by picking a size name it had
 *    not thought of.
 */

/**
 * Every app directory that renders `@chatofy/ui/react`, with the floor each must
 * clear.
 *
 * The floors are deliberately well under the real counts (7 / 26 / 14 / 25 at the
 * time of writing). They are not a coverage target — they exist so that a root
 * which stops resolving fails loudly instead of passing vacuously.
 */
const ROOTS = [
  { label: 'apps/web/app', path: '../../app', floor: 5, surface: 'web' },
  { label: 'apps/web/src', path: '..', floor: 15, surface: 'web' },
  {
    label: 'apps/extension/entrypoints',
    path: '../../../extension/entrypoints',
    floor: 8,
    surface: 'extension',
  },
  {
    label: 'apps/extension/src',
    path: '../../../extension/src',
    floor: 15,
    surface: 'extension',
  },
] as const;

/** Directories with nothing renderable in them, skipped so the counts mean something. */
const SKIP = new Set(['node_modules', '.next', '.output', '.wxt', 'dist', 'public']);

function walk(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || SKIP.has(entry.name)) continue;
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      found.push(...walk(full));
      continue;
    }
    // Specs are excluded, and they have to be: every ban below appears inside
    // one as the pattern that enforces it, so a spec in the corpus would report
    // the guard as its own first offender.
    if (/\.(tsx|ts)$/.test(entry.name) && !/\.spec\.tsx?$/.test(entry.name)) found.push(full);
  }
  return found;
}

/** Comments stripped: a rule explained by naming the thing it forbids is not a use of it. */
const sourcesIn = (path: string) =>
  walk(fileURLToPath(new URL(path, import.meta.url))).map((file) => ({
    file: file.slice(file.indexOf('/apps/') + 1),
    source: readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, ''),
  }));

const CORPUS = ROOTS.map((root) => ({ ...root, files: sourcesIn(root.path) }));

describe('the app surfaces are held to the shared type scale', () => {
  // Before any ban, and per root. A green run over an empty corpus is the
  // failure mode this whole file is most likely to arrive at.
  it.each(CORPUS)('$label resolves to files', ({ label, files, floor }) => {
    expect(
      files.length,
      `${label} scanned ${files.length} files — a root that resolves to nothing ` +
        'passes every ban below without reading anything',
    ).toBeGreaterThanOrEqual(floor);
  });

  /**
   * Tailwind's own size names, which this project replaced with role names.
   *
   * `text-sm` is 14px in Tailwind and 12px here, so the two do not mean the same
   * thing and a file mixing them is typeset from two scales at once. `2xl`
   * onwards is included because that is the one that actually shipped.
   */
  const SIZE_NAMES = /\btext-(xs|sm|base|lg|xl|[0-9]xl)\b/;

  /**
   * And the escape from it. Replacing `text-2xl` with `text-[28px]` satisfies a
   * ban on size names while leaving the same problem: a number that no longer
   * moves when the scale does.
   */
  const ARBITRARY_SIZE = /\btext-\[[0-9.]+(px|rem|em)\]/;

  it.each(CORPUS)('$label uses role names, not size names', ({ files }) => {
    const offenders = files.filter(({ source }) => SIZE_NAMES.test(source)).map(({ file }) => file);
    expect(
      offenders,
      'the type scale is by role — text-label, text-hint, text-body, text-translation, ' +
        'text-heading, text-title. Tailwind’s text-sm is 14px against this project’s 12',
    ).toEqual([]);
  });

  it.each(CORPUS)('$label does not hard-code a type size', ({ files }) => {
    const offenders = files
      .filter(({ source }) => ARBITRARY_SIZE.test(source))
      .map(({ file }) => file);
    expect(
      offenders,
      'an arbitrary px value is a size name by another spelling — it stops moving when ' +
        'the scale moves. Use the role token',
    ).toEqual([]);
  });

  /**
   * The fade that reads as disabled, banned on the apps as well as the package.
   *
   * `packages/ui/src/react/skin-guard.spec.ts` grew this row after `badge.tsx` was
   * found carrying stock shadcn's `[a&]:hover:bg-primary/90` — a rule the
   * guidelines had stated since the re-skin table was written, with no test behind
   * it, so it drifted. The apps are clean today; this keeps them that way, and the
   * cost of adding it while they are clean is zero.
   *
   * Wider than the hover spelling on purpose: `bg-primary/70` in any state is the
   * same mistake, and a ban naming only what shipped invites the next one.
   */
  const FADED_PRIMARY = /\bbg-primary\/\d/;

  it.each(CORPUS)('$label does not fade a filled primary', ({ files }) => {
    const offenders = files
      .filter(({ source }) => FADED_PRIMARY.test(source))
      .map(({ file }) => file);
    expect(
      offenders,
      'fading a filled control on a dark ground reads as disabled, not as hovered. ' +
        'Use hover:bg-accent-hover',
    ).toEqual([]);
  });

  /**
   * `dark:` on the extension only, and the asymmetry is the answer to a question
   * this plan left open.
   *
   * `apps/web/app/globals.css` declares `@custom-variant dark` deliberately, so a
   * `dark:` utility there is supported and web is exempt. The popup's `theme.css`
   * declares no such variant and records that it must not: the palette is
   * `light-dark()` based and the theme class is absent under "follow the
   * machine", so a `dark:` utility never fires while every token still flips —
   * the light treatment on a dark ground, silently, for most people.
   *
   * No violation exists today. This is what keeps that true.
   */
  it.each(CORPUS.filter((root) => root.surface === 'extension'))(
    '$label uses no dark: utility',
    ({ files }) => {
      const offenders = files
        .filter(({ source }) => /(?:^|[\s"'`:])(?:[\w\-[\]]+:)*dark:/m.test(source))
        .map(({ file }) => file);
      expect(
        offenders,
        'the popup declares no `dark` custom variant and must not — see its theme.css. ' +
          'A dark: utility there never fires while every light-dark() token still flips',
      ).toEqual([]);
    },
  );
});
