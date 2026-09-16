import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { envSchema } from './env';
import { serverEnvSchema } from './server-env';

/**
 * Holds `.env.example` and the two config schemas together.
 *
 * The api spec of the same shape explains the convention in full; the short of
 * it is that a template restating a default creates a second place to maintain
 * it, and a template missing a key teaches a new checkout to leave it out.
 *
 *   KEY=value      a live value: no schema default, or a deliberate override.
 *   # KEY=value    switched off. Where the key has a default, this is that
 *                  default shown for reference and must still equal it.
 *
 * Two hoisted fixtures make the modules importable outside Next:
 *
 * `server-only` throws by design when it is imported anywhere but a server
 * component, which is the guard that stops a secret reaching the browser
 * bundle. A spec is neither, so it is replaced with an empty module rather than
 * weakened at its source.
 *
 * `server-env.ts` parses at import time and AUTH_SECRET is required, so the
 * environment gets a throwaway one. Nothing here reads a value: the specs below
 * look only at the shape of the schemas. `??=` yields to any real value, so a
 * CI run carrying its own secret is unaffected.
 *
 * That write stays inside this file because vitest isolates workers per file.
 * The runner prints an "at least ~1.2s faster with isolate: false" hint on
 * every web run — take that hint and this line starts setting AUTH_SECRET for
 * every other spec in the suite.
 */
vi.mock('server-only', () => ({}));
vi.hoisted(() => {
  process.env.AUTH_SECRET ??= 'value-used-by-this-spec-only';
});

const LIVE_LINE = /^([A-Z][A-Z0-9_]*)=(.*)$/gm;
// The value group is `\S*`, not `.*`: a comment paragraph that line-wraps so
// a `KEY=value` lands at the start of a `# ` line would otherwise register as
// a commented default, which it is not. That has happened twice already. A
// real commented value never contains a space, and if one ever does the key
// simply stops being documented — which the first assertion below fails on,
// loudly, rather than quietly dropping it from the checks.
const COMMENTED_LINE = /^# ([A-Z][A-Z0-9_]*)=(\S*)$/gm;

type Line = { key: string; value: string };

const collect = (text: string, pattern: RegExp): Line[] =>
  [...text.matchAll(pattern)].map((match) => ({
    key: match[1] ?? '',
    value: (match[2] ?? '').trim(),
  }));

/**
 * A commented key line whose value carries a space — ambiguous between a
 * commented default and a comment paragraph that wrapped onto `# KEY=value`.
 * COMMENTED_LINE stops at the first space so prose is left alone, which means a
 * real commented default that gains a stray word would otherwise stop being
 * checked. Only names this app's own consumers recognise count.
 */
const AMBIGUOUS_LINE = /^# ([A-Z][A-Z0-9_]*)=(.*)$/gm;

const ambiguousLines = (text: string, known: string[]): string[] =>
  collect(text, AMBIGUOUS_LINE)
    .filter((line) => known.includes(line.key) && /\s/.test(line.value))
    .map((line) => `${line.key}=${line.value}`);

const shapes = { ...envSchema.shape, ...serverEnvSchema.shape };
const schemaKeys = Object.keys(shapes);

/**
 * The value a schema falls back to when a key is absent, as a template would
 * spell it, or `undefined` when there is no default — the required keys, and
 * the optionals whose absence means "feature off".
 */
const defaultFor = (key: string): string | undefined => {
  const field = shapes[key as keyof typeof shapes];
  if (field === undefined) return undefined;
  const parsed = field.safeParse(undefined);
  if (!parsed.success || parsed.data === undefined) return undefined;
  const spelled = String(parsed.data);
  // A `z.preprocess` that does not special-case `undefined` the way
  // booleanFromEnv does would stringify into one of these, and the gate
  // would then enforce that nonsense as the default. Fail on the schema
  // instead of on the template it would accuse.
  if (['undefined', 'null', 'NaN', '[object Object]'].includes(spelled)) {
    throw new Error(
      `${key} has a default that does not survive being written into a .env line: ${spelled}`,
    );
  }
  return spelled;
};

describe('apps/web/.env.example', () => {
  const text = readFileSync(resolve(__dirname, '../..', '.env.example'), 'utf8');
  const live = collect(text, LIVE_LINE);
  const commented = collect(text, COMMENTED_LINE);
  const documented = [...live, ...commented];

  // Read by next.config.ts straight from process.env at BUILD time, to derive
  // the CSP img-src — never by a module either schema validates. It belongs in
  // the template all the same: a build that omits it silently loses every
  // avatar.
  const NON_SCHEMA_KEYS = ['R2_PUBLIC_BASE_URL'];

  it('documents every key the schemas read', () => {
    const documentedKeys = documented.map((line) => line.key);
    expect(schemaKeys.filter((key) => !documentedKeys.includes(key))).toStrictEqual([]);
  });

  it('documents nothing the app cannot read', () => {
    expect(
      documented
        .map((line) => line.key)
        .filter((key) => !schemaKeys.includes(key) && !NON_SCHEMA_KEYS.includes(key)),
    ).toStrictEqual([]);
  });

  it('leaves no commented line ambiguous between a default and prose', () => {
    expect(ambiguousLines(text, [...schemaKeys, ...NON_SCHEMA_KEYS])).toStrictEqual([]);
  });

  it('names each key once', () => {
    const keys = documented.map((line) => line.key);
    expect(keys.filter((key, index) => keys.indexOf(key) !== index)).toStrictEqual([]);
  });

  it('spends no live line on a value a schema already defaults to', () => {
    expect(
      live.filter((line) => line.value === defaultFor(line.key)).map((line) => line.key),
    ).toStrictEqual([]);
  });

  it('keeps every commented line equal to the default it claims to show', () => {
    expect(
      commented
        .filter((line) => {
          const fallback = defaultFor(line.key);
          return fallback !== undefined && line.value !== fallback;
        })
        .map((line) => `${line.key}=${line.value}`),
    ).toStrictEqual([]);
  });
});
