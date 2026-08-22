#!/usr/bin/env node
/**
 * What the built package must look like, checked against the artifact.
 *
 * Deliberately not a vitest spec. `test` depends on `^build` — dependencies'
 * builds, never the package's own — so a spec that opens the output directory
 * runs where that directory may not exist, and the usual repair is to teach it to
 * skip when absent, which turns it green forever. This runs under `verify:build`,
 * whose turbo task depends on `build` without the caret.
 *
 * Two things are asserted, and both are load-bearing rather than tidy:
 *
 * The React chunks must open with `"use client"`. esbuild hoists the directive
 * out of source and drops it, so it is reapplied as a banner. The usual plugin for
 * preserving it is a single-maintainer 0.0.x last touched in 2024, which is not
 * something to put under a build — the banner is the mechanism, and this is what
 * says it still fired. Without it Next treats the module as a server component
 * and the app fails at the first hook.
 *
 * The tokens chunks must NOT. `apps/mobile` imports that entry through Metro; a
 * stray client directive there is at best noise and at worst a bundler error, and
 * its presence would mean the two configs had bled into each other.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../dist/', import.meta.url));

/** [file, must the first line be the client directive?] */
const EXPECTED = [
  ['react.js', true],
  ['react.cjs', true],
  ['index.js', false],
  ['index.cjs', false],
];

const DIRECTIVE = /^["']use client["'];?/;

let failed = false;

for (const [file, wantsDirective] of EXPECTED) {
  const path = `${dir}${file}`;
  if (!existsSync(path)) {
    // A missing artifact fails loudly. Skipping here is how this check would
    // become a permanent pass on a machine that never built.
    console.error(`FAIL  ${file.padEnd(10)} not built — run the package build first`);
    failed = true;
    continue;
  }

  const first = readFileSync(path, 'utf8').split('\n', 1)[0] ?? '';
  const has = DIRECTIVE.test(first.trim());

  if (has === wantsDirective) {
    console.log(
      `ok    ${file.padEnd(10)} ${wantsDirective ? 'client directive present' : 'no directive, as required'}`,
    );
  } else {
    failed = true;
    console.error(
      wantsDirective
        ? `FAIL  ${file.padEnd(10)} missing "use client" — the tsup banner did not survive. First line: ${JSON.stringify(first)}`
        : `FAIL  ${file.padEnd(10)} carries "use client", which Metro reads. The React config has bled into the tokens one.`,
    );
  }
}

if (failed) process.exit(1);
