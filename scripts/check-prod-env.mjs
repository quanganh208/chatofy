#!/usr/bin/env node
/**
 * Fails when the deployment's prod.env has drifted from prod.env.example.
 *
 * prod.env lives on the deploy host, outside the repository, so nothing else
 * notices when a key the code now needs is missing from it or a key nobody
 * reads any more is still in it: a missing key surfaces only as a runtime
 * default, a stale one as a setting that silently does nothing.
 *
 * Usage: node scripts/check-prod-env.mjs <prod.env> [--example <file>]
 *
 * Only key NAMES are read out of the files and printed; a value never leaves
 * the parser, because prod.env holds secrets and this runs in CI logs.
 *
 * In the example, `KEY=value` is a key the deployment must set, and a
 * commented `# KEY=value` is an optional one: allowed in prod.env, never
 * required. Prose in a comment is not a key line — only `# ` directly followed
 * by NAME= counts, matching the convention env.schema.spec.ts enforces.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const KEY = '[A-Za-z_][A-Za-z0-9_]*';
const LIVE_LINE = new RegExp(`^\\s*(?:export\\s+)?(${KEY})\\s*=`);
const OPTIONAL_LINE = new RegExp(`^#\\s(${KEY})=`);

/** Key names set by a dotenv-style file (blank and comment lines ignored). */
export function liveKeys(text) {
  const keys = new Set();
  for (const line of text.split(/\r?\n/)) {
    const match = LIVE_LINE.exec(line);
    if (match) keys.add(match[1]);
  }
  return keys;
}

/** Key names the example documents as switched off (`# KEY=value`). */
export function optionalKeys(text) {
  const keys = new Set();
  for (const line of text.split(/\r?\n/)) {
    const match = OPTIONAL_LINE.exec(line);
    if (match) keys.add(match[1]);
  }
  return keys;
}

/**
 * Compares the two files' key sets.
 *
 * @returns `missing`: required by the example, absent from prod.env.
 *          `unknown`: set in prod.env, named nowhere in the example.
 */
export function diffEnvKeys(prodText, exampleText) {
  const prod = liveKeys(prodText);
  const required = liveKeys(exampleText);
  const optional = optionalKeys(exampleText);
  return {
    missing: [...required].filter((key) => !prod.has(key)).sort(),
    unknown: [...prod].filter((key) => !required.has(key) && !optional.has(key)).sort(),
  };
}

function main(argv) {
  const args = argv.slice(2);
  const exampleFlag = args.indexOf('--example');
  let examplePath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'prod.env.example');
  if (exampleFlag !== -1) {
    const value = args[exampleFlag + 1];
    if (!value) return usage();
    examplePath = resolve(value);
    args.splice(exampleFlag, 2);
  }
  const [prodPath, ...rest] = args;
  if (!prodPath || rest.length > 0) return usage();

  let prodText;
  let exampleText;
  try {
    prodText = readFileSync(prodPath, 'utf8');
    exampleText = readFileSync(examplePath, 'utf8');
  } catch (err) {
    console.error(`check-prod-env: cannot read ${err.path ?? 'input'}: ${err.code ?? err.message}`);
    return 1;
  }

  const { missing, unknown } = diffEnvKeys(prodText, exampleText);
  for (const key of missing) {
    console.error(`::error::prod.env is missing ${key} (required by prod.env.example)`);
  }
  for (const key of unknown) {
    console.error(`::error::prod.env sets ${key}, which prod.env.example does not list`);
  }
  if (missing.length > 0 || unknown.length > 0) {
    console.error(
      `prod.env has drifted from prod.env.example: ${missing.length} missing, ${unknown.length} unknown`,
    );
    return 1;
  }
  console.log(`prod.env matches prod.env.example (${liveKeys(prodText).size} keys)`);
  return 0;
}

function usage() {
  console.error('usage: node scripts/check-prod-env.mjs <prod.env> [--example <file>]');
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv);
}
