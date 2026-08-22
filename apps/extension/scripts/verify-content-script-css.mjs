import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * No stylesheet reaches a meeting page.
 *
 * The popup is a React and Tailwind surface; the content script is not, and the
 * difference is enforced here rather than left to whoever writes the next import.
 * Two things go wrong when a content script imports CSS. Tailwind's Preflight
 * lands on meet.google.com and restyles the host's own document — every `button`,
 * every `h1`, on a page this extension does not own. And Chrome registers the
 * stylesheet in `document.styleSheets`, where the meeting site can enumerate it:
 * a stable fingerprint saying "this visitor runs Chatofy". That is the same
 * exposure the missing `web_accessible_resources` section in `wxt.config.ts`
 * exists to avoid, and `src/content/overlay-invariants.spec.ts` guards from the
 * source side.
 *
 * Checked against the built artifact, not the source. A source rule can be
 * satisfied by an import written three modules deep in a shared helper; only the
 * bundler knows where the CSS actually ended up.
 *
 * Both halves are asserted because either one alone can be true while the page is
 * still polluted. Verified empirically against this WXT version: adding a single
 * `import './probe.css'` to the content script produced BOTH a
 * `content-scripts/content.css` asset and a `css` array in the manifest entry. A
 * future WXT could emit one without the other, and a structural check on both
 * catches the injection path nobody has thought of yet.
 */

const here = dirname(fileURLToPath(import.meta.url));
const output = resolve(here, '../.output/chrome-mv3');

const problems = [];

// A missing build is a failure, not a skip. This runs under a turbo task that
// depends on `build` without the caret, so the directory is there — and if it
// ever is not, the guard reporting green would be the worst of the two outcomes.
if (!existsSync(output)) {
  problems.push(
    `no build at ${output}. This guard reads the built extension; run it through ` +
      '`pnpm verify:build`, which depends on the build task.',
  );
} else {
  const manifest = JSON.parse(readFileSync(join(output, 'manifest.json'), 'utf8'));

  for (const [index, entry] of (manifest.content_scripts ?? []).entries()) {
    const css = entry.css ?? [];
    if (css.length > 0) {
      problems.push(
        `manifest content_scripts[${index}] registers ${css.length} stylesheet(s) ` +
          `with Chrome: ${css.join(', ')}. Chrome injects these into the meeting ` +
          "page's own document.",
      );
    }
  }

  const scripts = join(output, 'content-scripts');
  if (existsSync(scripts)) {
    const sheets = readdirSync(scripts).filter((name) => name.endsWith('.css'));
    if (sheets.length > 0) {
      problems.push(
        `built stylesheet(s) under content-scripts/: ${sheets.join(', ')}. Some ` +
          'content script imported CSS, directly or through a module it pulls in.',
      );
    }
  }
}

if (problems.length > 0) {
  console.error('Content scripts must ship no CSS.\n');
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error(
    '\nThe overlay styles itself from `entrypoints/content/overlay-styles.ts`, as a\n' +
      'string adopted into its closed shadow root. Nothing it renders needs a\n' +
      'stylesheet in the page.',
  );
  process.exit(1);
}

console.log('content scripts ship no CSS: manifest css[] empty, no .css emitted');
