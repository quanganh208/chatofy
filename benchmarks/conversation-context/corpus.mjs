// The corpus format every script in this directory reads, and the checks that
// stand between it and a paid call.
//
// One file of turns (`data/corpus.jsonl`) and one of conversations
// (`data/conversations.jsonl`). The turns are written by `export-turns.mjs` as
// drafts and finished by hand: `reference`, each kept term's `mustMatch` and
// `target`, and each conversation's `domain`. A reference must be a person's
// words, never a model's (a model-written reference would score the model
// against itself). A terms-only corpus carries no references: the go/no-go
// reads only term accuracy and anchoring flips, and chrF++ is skipped.
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, '..', '..');
export const DATA = join(HERE, 'data');

export const LANGUAGES = {
  vi_to_en: { source: 'vi', target: 'en' },
  en_to_vi: { source: 'en', target: 'vi' },
};

/**
 * Which part of a conversation a turn sits in, by its 1-based index there.
 *
 * The question the corpus answers is whether knowing the conversation helps a
 * LATER turn more than an early one, so the buckets are positions, not lengths.
 */
export function bucketOf(index) {
  if (index <= 5) return '1-5';
  if (index <= 15) return '6-15';
  return '16+';
}
export const BUCKETS = ['1-5', '6-15', '16+'];

/** JSONL in, one object per line, naming the line that failed to parse. */
export function readJsonl(path) {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (err) {
        throw new Error(`${path}:${index + 1} is not valid JSON: ${err.message}`);
      }
    });
}

/** A row's identity across arms and repeats. */
export const rowKey = (row) => `${row.conv}#${row.pos}`;

/** An anchoring-control row: a complete sentence an earlier turn could pull wrong. */
export const isControl = (row) => row.control === 'anchoring';

/**
 * Every reason the corpus is not ready for a paid run; empty when it is.
 *
 * Collected rather than thrown at the first, so one pass over the file tells
 * the writer everything still missing. `scoreRow` throws on a missing
 * `mustMatch`, and a run that discovers that after spending its calls has
 * bought nothing.
 */
export function corpusProblems(
  rows,
  conversations,
  { needDomain = false, needReference = true } = {},
) {
  const problems = [];
  const seen = new Set();
  for (const row of rows) {
    const at = rowKey(row);
    if (seen.has(at)) problems.push(`${at}: duplicate conv/pos`);
    seen.add(at);
    if (!LANGUAGES[row.direction]) problems.push(`${at}: no usable direction`);
    if (typeof row.source !== 'string' || !row.source.trim()) problems.push(`${at}: no source`);
    if (needReference && (typeof row.reference !== 'string' || !row.reference.trim())) {
      problems.push(`${at}: no reference`);
    }
    for (const [i, term] of (row.terms ?? []).entries()) {
      if (typeof term.mustMatch !== 'string' || !term.mustMatch) {
        problems.push(
          `${at}: terms[${i}] (${term.source}) has no mustMatch; fill it or delete the term`,
        );
      }
      if (typeof term.target !== 'string' || !term.target.trim()) {
        problems.push(`${at}: terms[${i}] (${term.source}) has no target rendering`);
      }
    }
    if (isControl(row) && (typeof row.mustNotMatch !== 'string' || !row.mustNotMatch)) {
      problems.push(`${at}: anchoring control without mustNotMatch`);
    }
  }
  const known = new Map(conversations.map((c) => [c.conv, c]));
  for (const conv of new Set(rows.map((row) => row.conv))) {
    const meta = known.get(conv);
    if (!meta) problems.push(`${conv}: missing from conversations.jsonl`);
    else if (needDomain && (typeof meta.domain !== 'string' || !meta.domain.trim())) {
      problems.push(`${conv}: no domain`);
    }
  }
  return problems;
}

/** Turns grouped by conversation, each group in spoken order. */
export function byConversation(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.conv)) groups.set(row.conv, []);
    groups.get(row.conv).push(row);
  }
  for (const group of groups.values()) group.sort((a, b) => a.pos - b.pos);
  return groups;
}

/**
 * The `@chatofy/types` module instance `packages/ai-providers` resolves to, so
 * a word here is counted by the same `countTermWords` the prompt builder uses.
 * Requires the built packages (`pnpm --filter @chatofy/ai-providers build`).
 */
export async function typesModule() {
  const pkgDir = realpathSync(
    join(REPO, 'packages', 'ai-providers', 'node_modules', '@chatofy', 'types'),
  );
  const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
  const entry = pkg.exports?.['.']?.import?.default;
  if (!entry) throw new Error('@chatofy/types has no ESM entry');
  return import(pathToFileURL(realpathSync(join(pkgDir, entry))).href);
}
