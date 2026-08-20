#!/usr/bin/env node
/**
 * One React per bundler.
 *
 * `packages/ui` is about to declare React as a peer dependency and be consumed
 * by two apps that pin different exact versions — `apps/web` and `apps/mobile`.
 * A peer declaration is the right shape, but it is not the guarantee it looks
 * like here: `.npmrc` sets `auto-install-peers=true`, so an unsatisfied peer is
 * silently installed rather than reported, and `node-linker=hoisted` flattens
 * what would otherwise be isolated.
 *
 * Two React copies reachable from one bundle is the "Invalid hook call" every
 * React monorepo eventually meets. It is a *resolution* failure, so `tsc` cannot
 * see it, and `apps/mobile` has no build script — nothing in CI runs Metro. This
 * script is the gate that would otherwise not exist.
 *
 * Different versions across apps are fine and expected: Expo pins React to its
 * SDK matrix, and mobile never resolves the React subpath. What must not happen
 * is two copies reachable from a SINGLE app.
 */
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

/** Apps whose bundle must contain exactly one React. */
const APPS = ['apps/web', 'apps/mobile', 'apps/extension'];

/** Packages an app pulls React through, checked from that app's perspective. */
const VIA = ['@chatofy/ui'];

let failed = false;

for (const app of APPS) {
  const appRequire = createRequire(resolve(process.cwd(), app, 'package.json'));

  let own;
  try {
    own = appRequire.resolve('react');
  } catch {
    // An app with no React at all is not a problem — it is most of them, until
    // Phase 6. Nothing can be duplicated that is not there.
    console.log(`ok    ${app.padEnd(16)} no react`);
    continue;
  }

  const paths = new Set([own]);
  for (const pkg of VIA) {
    try {
      const viaRequire = createRequire(appRequire.resolve(`${pkg}/package.json`));
      paths.add(viaRequire.resolve('react'));
    } catch {
      // The package does not resolve React from here, which is the desired
      // answer for the token-only root entry.
    }
  }

  const version = appRequire('react/package.json').version;
  if (paths.size === 1) {
    console.log(`ok    ${app.padEnd(16)} react ${version} (1 copy)`);
  } else {
    failed = true;
    console.error(`FAIL  ${app.padEnd(16)} ${paths.size} react copies reachable:`);
    for (const path of paths) console.error(`        ${path}`);
  }
}

if (failed) {
  console.error(
    '\nOne bundle, two Reacts. Hooks will throw at runtime and no typecheck will say so.',
  );
  process.exit(1);
}
