import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Nothing in the shipped extension asks Chrome to compile a string.
 *
 * MV3's default `script-src 'self'` refuses `eval`, `new Function`, the string
 * form of `setTimeout`, and WebAssembly compilation. The refusal is silent in the
 * sense that matters: the extension loads, the popup opens, and the one code path
 * that reaches the forbidden call throws at runtime, in front of a user, possibly
 * mid-meeting. A build-time check is the only place this is cheap to find.
 *
 * This is a text search, and text searches over minified output are a weak proxy —
 * a bundler can spell `eval` as a computed property and this sees nothing. It is
 * kept because it is nearly free and it catches the realistic case: a dependency
 * that ships a `new Function` fast path. The strong evidence is in `e2e/run.mjs`,
 * which drives a real Chromium with this extension loaded and fails on a CSP
 * console error. Cheap-and-fallible plus expensive-and-direct; neither alone.
 *
 * Only `chrome-mv3` is read. The `*-dev` siblings hold Vite's HMR client, which
 * legitimately evaluates strings and is never shipped.
 *
 * One shape is exempt, and it is a property rather than a name: a string-compile
 * wrapped in `try`/`catch` is a capability probe with a fallback already written,
 * so CSP refusing it is the answer it was asking for, not a crash. Zod v4 ships
 * exactly this — it JIT-compiles object parsers where the environment allows it
 * and interprets them where it does not — and it arrives here through
 * `@chatofy/types`. Exempting the shape instead of allow-listing the file means a
 * second dependency doing the same safe thing needs no edit, while an unguarded
 * call anywhere still fails.
 *
 * Nothing else watches the exempt shape either — `e2e/run.mjs` was tried against
 * a planted `try { new Function('') } catch {}` that survived bundling and ran,
 * and Chrome surfaced neither a page error nor a console message. So the
 * exemption is not "covered elsewhere", it is "not a defect": a compile whose
 * failure is already handled cannot break anything, which is the entire property
 * being checked. What the pair does cover is the unguarded call — this file finds
 * it in the build, and the e2e finds it thrown in a real Chromium.
 */

const here = dirname(fileURLToPath(import.meta.url));
const output = resolve(here, '../.output/chrome-mv3');

/**
 * Each pattern is anchored so a longer identifier ending in the same letters does
 * not match — minified code is full of `isFunction(`, `_eval`, and `.evaluate(`.
 */
const FORBIDDEN = [
  { label: 'eval(', re: /(?<![\w$.])eval\s*\(/g },
  { label: 'indirect eval', re: /\(\s*0\s*,\s*eval\s*\)/g },
  { label: 'new Function(', re: /\bnew\s+Function\s*\(/g },
  { label: 'Function( as a call', re: /(?<![\w$.])Function\s*\(/g },
  { label: 'setTimeout with a string', re: /setTimeout\s*\(\s*['"`]/g },
  { label: 'setInterval with a string', re: /setInterval\s*\(\s*['"`]/g },
  { label: 'WebAssembly compilation', re: /WebAssembly\s*\.\s*(instantiate|compile)/g },
];

/**
 * Is this call inside a `try`/`catch`, i.e. a probe whose failure is handled?
 *
 * A window rather than a parse: the output is minified, and the distance from
 * `try{` to the call and on to `}catch` in that code is a few dozen characters.
 * Widening it trades a false pass for a false failure, and a false failure here
 * costs a real debugging session.
 */
const WINDOW = 200;

function isProbe(source, index) {
  const before = source.slice(Math.max(0, index - WINDOW), index);
  const after = source.slice(index, index + WINDOW);
  return /try\s*\{[^{}]*$/.test(before) && /\}\s*catch/.test(after);
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

if (!existsSync(output)) {
  console.error(
    `No build at ${output}. This guard reads the built extension; run it through ` +
      '`pnpm verify:build`, which depends on the build task.',
  );
  process.exit(1);
}

const hits = [];
for (const path of walk(output)) {
  if (!/\.(js|html)$/.test(path)) continue;
  const source = readFileSync(path, 'utf8');
  for (const { label, re } of FORBIDDEN) {
    re.lastIndex = 0;
    const unguarded = [...source.matchAll(re)].filter((match) => !isProbe(source, match.index));
    if (unguarded.length > 0) {
      hits.push({ file: relative(output, path), label, count: unguarded.length });
    }
  }
}

if (hits.length > 0) {
  console.error(
    "MV3's content security policy forbids compiling strings, and the build does it.\n",
  );
  for (const { file, label, count } of hits) {
    console.error(`  - ${file}: ${count}x ${label}`);
  }
  console.error(
    '\nThis fails at runtime, not at load: the extension installs and the call throws\n' +
      'only when something reaches it. Find which dependency emits it and either\n' +
      'configure it away or replace it.',
  );
  process.exit(1);
}

console.log(`no string-compilation in ${relative(process.cwd(), output)}`);
