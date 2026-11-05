// Turn a run's text into rows `translation-judge/judge.mjs` reads, each with
// what Scribe heard there, and report the hearing error against Scribe.
//
//   node benchmarks/conference/export-judge-rows.mjs --run <run-tag> \
//     [--results <dir>] [--polished] [--name <rows-name>]
//
// Writes `translation-judge/data/conference-<name>.jsonl`. Uses only the cached
// Scribe answers: a recording is never sent again. `--results` reads a
// call-budget run, which writes the same `text.jsonl`. `--polished` takes a
// turn's polished translation when it has one, which is what a reader of
// /translate ends up with and what a meeting has been throwing away.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const JUDGE_DATA = join(HERE, '..', 'translation-judge', 'data');
/** Same rule as `scribe_turns.py`: a turn's stamp can trail its first word. */
const LEAD_MS = 300;
const CONTEXT_TURNS = 4;

/** Cut (startMs, endMs, text) words into turns by midpoint, as `slice_words` does. */
export function sliceWords(words, startsMs, endMs = Infinity) {
  const bounds = startsMs
    .map((ms, index) => ({ bound: ms - LEAD_MS, index }))
    .sort((a, b) => a.bound - b.bound);
  const buckets = startsMs.map(() => []);
  for (const word of words) {
    const middle = (word.start + word.end) / 2;
    if (middle > endMs) continue;
    let owner = null;
    for (const { bound, index } of bounds) {
      if (bound <= middle) owner = index;
      else break;
    }
    if (owner !== null) buckets[owner].push(word.text);
  }
  return buckets.map((bucket) => (bucket.length ? bucket.join(' ') : null));
}

/** Lowercased words with punctuation gone; the same on both sides of a comparison. */
export function tokens(text) {
  return text
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** Levenshtein distance over words. */
export function editDistance(a, b) {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length];
}

/** Word error of what the app heard, over Scribe's words. */
export function wordErrorRate(rows) {
  let errors = 0;
  let words = 0;
  for (const row of rows) {
    if (row.scribe_missing) continue;
    const reference = tokens(row.scribe_source);
    errors += editDistance(tokens(row.source), reference);
    words += reference.length;
  }
  return words === 0 ? null : errors / words;
}

function scribeWords(recording) {
  const path = join(JUDGE_DATA, 'scribe', `${recording}.json`);
  if (!existsSync(path)) throw new Error(`no cached Scribe answer for ${recording}`);
  return JSON.parse(readFileSync(path, 'utf8'))
    .words.filter((word) => word.type === 'word')
    .map((word) => ({ start: word.start * 1000, end: word.end * 1000, text: word.text }));
}

const TARGET = { vi: 'en', en: 'vi' };

function rowsFor(recording, turns, polished) {
  const ordered = [...turns].sort((a, b) => a.mediaMs - b.mediaMs);
  // A run may stop partway through a recording: nothing after that was spoken.
  const spokenTo = Math.max(...ordered.map((turn) => turn.mediaEndMs ?? Infinity));
  const heard = sliceWords(
    scribeWords(recording),
    ordered.map((turn) => turn.mediaMs),
    spokenTo,
  );
  const rows = [];
  ordered.forEach((turn, pos) => {
    const target = TARGET[turn.language];
    const translation =
      (polished ? turn.polished?.[target] : undefined) ?? turn.translations[target];
    if (!translation) return;
    rows.push({
      conv: recording,
      pos,
      direction: `${turn.language}_to_${target}`,
      source: turn.source,
      translation,
      words: turn.source.split(/\s+/).filter(Boolean).length,
      context: rows
        .slice(-CONTEXT_TURNS)
        .map(({ source, translation: text }) => ({ source, translation: text })),
      mediaMs: turn.mediaMs,
      scribe_source: heard[pos],
      scribe_missing: heard[pos] === null,
    });
  });
  return rows;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const value = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
  const run = value('--run');
  if (!run) throw new Error('--run <run-tag> is required');
  const polished = argv.includes('--polished');
  const name = value('--name') ?? `${run}${polished ? '-polished' : ''}`;
  const dir = join(value('--results') ?? join(HERE, 'results'), run);
  const turns = readFileSync(join(dir, 'text.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const byRecording = Map.groupBy(turns, (turn) => turn.recording);
  const rows = [...byRecording].flatMap(([recording, group]) =>
    rowsFor(recording, group, polished),
  );
  writeFileSync(
    join(JUDGE_DATA, `conference-${name}.jsonl`),
    rows.map((row) => JSON.stringify(row)).join('\n') + '\n',
  );
  const missing = rows.filter((row) => row.scribe_missing).length / (rows.length || 1);
  const wer = wordErrorRate(rows);
  console.log(
    `rows=${rows.length} missing=${missing.toFixed(3)} wer=${wer === null ? 'n/a' : wer.toFixed(4)}`,
  );
}
