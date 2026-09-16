import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { envSchema } from './env.schema';

/**
 * Holds the two `.env` templates and the schema together.
 *
 * They are two descriptions of one thing, and they drifted apart the first time
 * the schema gained a key: the two live-translation knobs landed in the schema
 * and reached `.env.example` a commit later. Worse than a missing line is a
 * copied one — a template that ships `PORT=3000` as a live value makes every
 * copy of it override a default it never meant to touch, and the override then
 * has to be maintained by hand forever.
 *
 * So the templates carry two line forms, and each one is checked:
 *
 *   KEY=value      a live value. Either the key has no schema default, or the
 *                  value deliberately differs from it.
 *   # KEY=value    switched off. Where the key has a schema default, this is
 *                  that default shown for reference, and it must still BE the
 *                  default or the comment is a lie.
 *
 * Prose inside a comment block is not a key line: a documented example is
 * indented further (`#   GEMINI_API_KEY=key-a,key-b`), and only `# ` followed
 * directly by the name counts.
 */

// `__dirname`, not `import.meta.url`: this app builds to CommonJS, where the
// meta-property is a compile error. From src/config that is apps/api.
const read = (name: string) =>
  readFileSync(resolve(__dirname, '../..', name), 'utf8');

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
 * The value the schema falls back to when a key is absent, as the string a
 * template would spell it, or `undefined` when the key has no default at all
 * (required keys, and the optionals whose absence means "feature off").
 */
const defaultFor = (key: string): string | undefined => {
  const field = envSchema.shape[key as keyof typeof envSchema.shape];
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

/**
 * Whether a commented line contradicts the default it is showing.
 *
 * Only keys that HAVE a default are judged. A commented line means two
 * different things across these files: in `.env.example` it is the schema's own
 * default, shown so nobody copies it into a live override; in `prod.env.example`
 * it is more often an optional block left switched off, with a value suggested
 * for whoever turns it on (the SMTP four) or a default that belongs to compose
 * rather than to this schema (the PROD_LOCAL_* sidecar knobs). Judging those
 * against a schema default they never claimed to have would be a false alarm.
 *
 * The constraint this leaves: a key that HAS a default cannot be shown
 * commented with a SUGGESTED override — `# TRUST_PROXY_HOPS=1` in the prod
 * template fails here, and the message will read as if the template were
 * wrong. Write the suggestion in prose instead. Allowing it would mean no
 * longer checking commented defaults at all, which is the check that catches
 * the drift this file exists for.
 */
const showsStaleDefault = ({ key, value }: Line): boolean => {
  const fallback = defaultFor(key);
  return fallback !== undefined && value !== fallback;
};

/**
 * A commented key line whose value carries a space.
 *
 * {@link COMMENTED_LINE} deliberately stops at the first space so a comment
 * paragraph wrapping onto `# KEY=value ...` is read as prose, not as a
 * commented default. The cost is that a REAL commented default which gains a
 * stray word simply stops being checked — invisible in `prod.env.example`,
 * which has no assertion that every key is present to trip over its absence.
 *
 * So the ambiguity itself is the failure. Only a name the file's own consumers
 * recognise counts, which leaves ordinary prose alone; when it does fire, the
 * fix is to reword the sentence or repair the value, and either way a human
 * decides which of the two a line was meant to be.
 */
const AMBIGUOUS_LINE = /^# ([A-Z][A-Z0-9_]*)=(.*)$/gm;

const ambiguousLines = (text: string, known: string[]): string[] =>
  collect(text, AMBIGUOUS_LINE)
    .filter((line) => known.includes(line.key) && /\s/.test(line.value))
    .map((line) => `${line.key}=${line.value}`);

/**
 * A live line the schema would refuse at boot.
 *
 * Equality-with-default catches a copied default; it says nothing about whether
 * a value is valid at all, so `SMTP_PORT=four-six-five` sat in a template
 * unchallenged until the first deployment that copied it. Empty is skipped —
 * that is the spelling for "unset" and every optional accepts it.
 */
const unparseableLines = (lines: Line[]): string[] =>
  lines
    .filter((line) => line.value !== '')
    .filter((line) => {
      const field = envSchema.shape[line.key as keyof typeof envSchema.shape];
      return field !== undefined && !field.safeParse(line.value).success;
    })
    .map((line) => line.key);

const schemaKeys = Object.keys(envSchema.shape);

/**
 * The keys the schema REFUSES to boot without — where parsing an absent value
 * fails outright, rather than falling back to a default or meaning "feature
 * off". Today that is DATABASE_URL and AUTH_JWT_SECRET.
 *
 * Used only on the production template, which carries a subset of the keys by
 * design. A subset is fine; a subset missing one of these is a deploy that
 * refuses to boot with the operator already committed, which is the drift this
 * file exists to catch.
 */
const requiredKeys = schemaKeys.filter(
  (key) =>
    !envSchema.shape[key as keyof typeof envSchema.shape].safeParse(undefined)
      .success,
);

describe('apps/api/.env.example', () => {
  const text = read('.env.example');
  const live = collect(text, LIVE_LINE);
  const commented = collect(text, COMMENTED_LINE);
  const documented = [...live, ...commented];

  // Read by Prisma's own CLI rather than by this app, so it is deliberately
  // absent from the schema — see the note on the key in the template.
  const NON_SCHEMA_KEYS = ['SHADOW_DATABASE_URL'];

  it('documents every key the schema reads', () => {
    const documentedKeys = documented.map((line) => line.key);
    expect(
      schemaKeys.filter((key) => !documentedKeys.includes(key)),
    ).toStrictEqual([]);
  });

  it('documents nothing the schema cannot read', () => {
    expect(
      documented
        .map((line) => line.key)
        .filter(
          (key) => !schemaKeys.includes(key) && !NON_SCHEMA_KEYS.includes(key),
        ),
    ).toStrictEqual([]);
  });

  it('leaves no commented line ambiguous between a default and prose', () => {
    expect(
      ambiguousLines(text, [...schemaKeys, ...NON_SCHEMA_KEYS]),
    ).toStrictEqual([]);
  });

  it('offers no live value the schema would refuse at boot', () => {
    expect(unparseableLines(live)).toStrictEqual([]);
  });

  it('names each key once', () => {
    const keys = documented.map((line) => line.key);
    expect(
      keys.filter((key, index) => keys.indexOf(key) !== index),
    ).toStrictEqual([]);
  });

  it('spends no live line on a value the schema already defaults to', () => {
    expect(
      live
        .filter((line) => line.value === defaultFor(line.key))
        .map((line) => line.key),
    ).toStrictEqual([]);
  });

  it('keeps every commented line equal to the default it claims to show', () => {
    expect(
      commented
        .filter((line) => showsStaleDefault(line))
        .map((line) => `${line.key}=${line.value}`),
    ).toStrictEqual([]);
  });
});

describe('prod.env.example', () => {
  const text = read('../../prod.env.example');
  const live = collect(text, LIVE_LINE);
  const commented = collect(text, COMMENTED_LINE);

  // This template is copied to one file the whole deployment shares, so it
  // carries keys three other consumers read: the compose file itself, the
  // postgres image, and the web app's Auth.js setup.
  const NON_SCHEMA_KEYS = [
    'CHATOFY_ENV_FILE',
    'POSTGRES_USER',
    'POSTGRES_PASSWORD',
    'POSTGRES_DB',
    'STT_MODELS_DIR',
    'TTS_MODELS_DIR',
    'AUTH_SECRET',
    'AUTH_URL',
    'AUTH_GOOGLE_ID',
    'AUTH_GOOGLE_SECRET',
    'NEXT_PUBLIC_API_BASE_URL',
    // Sidecar thread and concurrency knobs, read by docker-compose.prod.yml and
    // passed to the services under their unprefixed names. The PROD_ prefix
    // keeps them from colliding with the dev stack's values in a shell that has
    // both.
    'PROD_LOCAL_STT_THREADS',
    'PROD_LOCAL_TTS_THREADS',
    'PROD_LOCAL_STT_CONCURRENCY',
  ];

  // Supplied by docker-compose.prod.yml's per-service `environment:`, composed
  // from the compose network — `postgres:5432`, which no file copied to a host
  // could know. Setting it here would be outranked anyway.
  const COMPOSE_PINNED_KEYS = ['DATABASE_URL'];

  it('leaves no commented line ambiguous between a default and prose', () => {
    expect(
      ambiguousLines(text, [...schemaKeys, ...NON_SCHEMA_KEYS]),
    ).toStrictEqual([]);
  });

  it('offers no live value the schema would refuse at boot', () => {
    expect(unparseableLines(live)).toStrictEqual([]);
  });

  it('carries every key the schema refuses to boot without', () => {
    const present = [...live, ...commented].map((line) => line.key);
    expect(
      requiredKeys.filter(
        (key) => !present.includes(key) && !COMPOSE_PINNED_KEYS.includes(key),
      ),
    ).toStrictEqual([]);
  });

  it('carries nothing the schema and the deployment both cannot read', () => {
    expect(
      [...live, ...commented]
        .map((line) => line.key)
        .filter(
          (key) => !schemaKeys.includes(key) && !NON_SCHEMA_KEYS.includes(key),
        ),
    ).toStrictEqual([]);
  });

  it('spends no live line on a value the schema already defaults to', () => {
    expect(
      live
        .filter((line) => line.value === defaultFor(line.key))
        .map((line) => line.key),
    ).toStrictEqual([]);
  });

  it('keeps every commented line equal to the default it claims to show', () => {
    expect(
      commented
        .filter((line) => showsStaleDefault(line))
        .map((line) => `${line.key}=${line.value}`),
    ).toStrictEqual([]);
  });
});

/**
 * The root template is not about this schema at all — Compose is its only
 * consumer, and every key it names carries its default inline as
 * `${KEY:-value}`. Same convention, different authority, so it is checked the
 * same way: nothing Compose reads may go undocumented, and no documented
 * default may disagree with the one Compose applies.
 *
 * It lives in this file because the api spec already gates a repo-root
 * template, and a second runner at the root would exist for two assertions.
 */
describe('.env.example (repo root)', () => {
  const composeDefaults = new Map(
    [
      ...read('../../docker-compose.yml').matchAll(
        /\$\{([A-Z][A-Z0-9_]*):-([^}]*)\}/g,
      ),
    ].map((match) => [match[1] ?? '', match[2] ?? '']),
  );
  const documented = new Map(
    collect(read('../../.env.example'), COMMENTED_LINE).map((line) => [
      line.key,
      line.value,
    ]),
  );

  it('documents every variable docker-compose.yml reads', () => {
    expect(
      [...composeDefaults.keys()].filter((key) => !documented.has(key)),
    ).toStrictEqual([]);
  });

  it('leaves no commented line ambiguous between a default and prose', () => {
    expect(
      ambiguousLines(read('../../.env.example'), [...composeDefaults.keys()]),
    ).toStrictEqual([]);
  });

  it('shows the same default Compose applies', () => {
    expect(
      [...composeDefaults]
        .filter(
          ([key, value]) =>
            documented.has(key) && documented.get(key) !== value,
        )
        .map(
          ([key, value]) =>
            `${key}: compose=${value} template=${documented.get(key)}`,
        ),
    ).toStrictEqual([]);
  });
});
