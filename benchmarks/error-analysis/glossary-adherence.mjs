// Did the translation actually use the term the glossary names?
//
//   node benchmarks/error-analysis/glossary-adherence.mjs glossary.json \
//     results/deepseek-after.jsonl results/after.jsonl
//
// `analyze.mjs` answers "what kind of wrong is this row". This answers a
// narrower question it cannot: when the source contained a glossary term, did
// the output carry its counterpart. That is the ONE property the AI Context
// feature promises, and it is the property exact-match is worst at seeing —
// a row can use every term correctly and still differ from the reference
// somewhere else, or match the reference while ignoring the glossary entirely.
//
// Why it exists: the exact count on this corpus has a noise floor of about ±2
// out of 40 (re-running an unchanged arm moves it that far), which is the size
// of the effect it was being asked to detect. Counting term occurrences instead
// gives 44 observations rather than 40, and they are stable — three repeats of
// the same arm on `deepseek-flash` scored identically.
//
// Reads only `source`, `direction` and `hypothesis`, so it scores arms that
// `translate-rows.mjs` already wrote. Like `analyze.mjs` it never translates,
// and it writes to stdout only.
import { readFileSync } from 'node:fs';

/**
 * Normalization for CONTAINMENT, which is a different job from the match-fold
 * `classify.mjs` uses.
 *
 * Diacritics are deliberately KEPT. Vietnamese glossary entries differ from
 * their wrong alternatives by tone as often as by letters — `luận văn` against
 * `luận án` is the pair this corpus actually hit — so folding tones away would
 * score a wrong term as a hit.
 */
const fold = (text) =>
  text
    .toLowerCase()
    .normalize('NFC')
    .replace(/[.,!?;:'"()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const [glossaryPath, ...rowPaths] = process.argv.slice(2);
if (!glossaryPath || !rowPaths.length) {
  throw new Error('usage: glossary-adherence.mjs <glossary.json> <rows.jsonl> [rows.jsonl…]');
}

const parsed = JSON.parse(readFileSync(glossaryPath, 'utf8'));
const glossary = Array.isArray(parsed) ? parsed : parsed.glossary;
if (!Array.isArray(glossary) || !glossary.length) {
  throw new Error(`${glossaryPath} carries no glossary entries`);
}

const SIDES = {
  vi_to_en: { source: 'vi', target: 'en' },
  en_to_vi: { source: 'en', target: 'vi' },
};

function readRows(path) {
  const rows = readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (err) {
        throw new Error(`${path}:${index + 1} is not valid JSON: ${err.message}`);
      }
    });
  const noDirection = rows.filter((row) => !SIDES[row.direction]);
  if (noDirection.length) {
    throw new Error(`${path}: ${noDirection.length} rows have no usable \`direction\``);
  }
  return rows;
}

/**
 * The glossary entries this row's SOURCE actually contains, longest first, with
 * entries nested inside a longer match dropped.
 *
 * The nesting rule is not tidiness. `hội đồng phản biện ⇄ thesis defense
 * committee` and `bảo vệ luận văn ⇄ thesis defense` are both entries, and the
 * second is a substring of the first — so a source naming the committee matches
 * both, and demanding both counterparts marks a perfectly correct output wrong.
 * Only the most specific term that matched is scored.
 */
function applicable(row) {
  const { source: sourceSide, target: targetSide } = SIDES[row.direction];
  const source = fold(row.source);
  const matched = glossary
    .filter((entry) => source.includes(fold(entry[sourceSide])))
    .sort((a, b) => fold(b[sourceSide]).length - fold(a[sourceSide]).length);

  const kept = [];
  for (const entry of matched) {
    const term = fold(entry[sourceSide]);
    if (kept.some((other) => fold(other[sourceSide]).includes(term))) continue;
    kept.push(entry);
  }
  return kept.map((entry) => ({ from: entry[sourceSide], to: entry[targetSide] }));
}

const scored = rowPaths.map((path) => {
  const rows = readRows(path);
  const models = [...new Set(rows.map((row) => row.model).filter(Boolean))];
  let hit = 0;
  const misses = [];
  let total = 0;
  for (const row of rows) {
    for (const term of applicable(row)) {
      total += 1;
      if (fold(row.hypothesis ?? '').includes(fold(term.to))) hit += 1;
      else misses.push({ id: row.id, want: term.to, got: row.hypothesis ?? '' });
    }
  }
  return { path, models, hit, total, misses };
});

const basename = (path) => path.split('/').pop();

console.log('# Glossary adherence\n');
console.log('How often an output carried the term the glossary names for a term in its source.\n');
console.log('| Arm | Model | Used | Occurrences | Rate |');
console.log('|---|---|---|---|---|');
for (const arm of scored) {
  const rate = arm.total ? ((arm.hit / arm.total) * 100).toFixed(1) : '—';
  console.log(
    `| ${basename(arm.path)} | ${arm.models.join(', ') || '—'} | ${arm.hit} | ${arm.total} | ${rate}% |`,
  );
}

// A term missed in every arm is a property of the corpus or the entry; one
// missed in some is the model varying. Separating them is the whole reason
// several files can be scored at once.
const tally = new Map();
for (const arm of scored) {
  for (const miss of arm.misses) {
    const key = `${miss.id} → ${miss.want}`;
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }
}

if (tally.size) {
  console.log(`\n## Misses, by how many of the ${scored.length} arm(s) they appear in\n`);
  for (const [key, count] of [...tally.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`- ${count}/${scored.length} — ${key}`);
  }
  console.log(
    '\nRead these before counting them as failures. An entry whose source side is a ' +
      'NOUN can appear in a sentence that uses the idea as a verb — `kê đơn thuốc` ' +
      'answered by "prescribed medication" is a correct translation and an ' +
      'unavoidable miss here, and it misses identically for every model, which is ' +
      'how it can be told apart from one that got the term wrong.',
  );
}
