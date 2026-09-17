// Turn a file of graded translations into a table that names the next action.
//
//   node benchmarks/error-analysis/analyze.mjs rows.jsonl
//
// Input is JSONL, one row per translation:
//   {"id":"u012","source":"tôi đi VinFast","hypothesis":"I go Vinfat",
//    "reference":"I drive a VinFast","label":"proper-noun"}
//
// `label` is optional and holds the judgement a string comparison cannot make —
// geographic, factual, register, homophone. Everything else is computed.
import { readFileSync } from 'node:fs';
import { CATEGORIES, tally } from './classify.mjs';

const path = process.argv[2];
if (!path) {
  console.error('usage: node analyze.mjs <rows.jsonl>');
  process.exit(2);
}

const rows = readFileSync(path, 'utf8')
  .split('\n')
  .filter((line) => line.trim())
  .map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (err) {
      throw new Error(`${path}:${index + 1} is not valid JSON: ${err.message}`);
    }
  });

const missing = rows.filter((row) => !row.reference?.trim()).length;
if (missing) {
  // Refuses rather than skipping, for the same reason `score-adequacy.py` does:
  // a rate computed over whichever rows happened to have a reference is a
  // number nobody chose.
  console.error(`${missing} of ${rows.length} rows have no reference. Nothing scored.`);
  process.exit(2);
}

const unanswered = rows.filter((row) => !row.hypothesis?.trim()).length;
if (unanswered) {
  // The same refusal, for the row the RUNNER can produce: a request that threw
  // is written out with an empty hypothesis, and an empty hypothesis matches no
  // reference, so it would enter the taxonomy as a total translation error. One
  // API hiccup would then read as a quality regression.
  console.error(`${unanswered} of ${rows.length} rows have no hypothesis. Nothing scored.`);
  process.exit(2);
}

const result = tally(rows);
const errors = result.total - (result.byCategory.exact ?? 0);

const out = [
  '# Translation Error Taxonomy',
  '',
  `${result.total} rows · ${errors} with a difference · ${result.byCategory.exact ?? 0} exact`,
  '',
  '## Automatic categories',
  '',
  '| Category | Count | Share of errors | Severity |',
  '|---|---|---|---|',
];

for (const [category, count] of Object.entries(result.byCategory)) {
  if (category === 'exact') continue;
  const share = errors ? `${((count / errors) * 100).toFixed(1)}%` : 'n/a';
  out.push(`| ${category} | ${count} | ${share} | ${CATEGORIES[category].severity} |`);
}

out.push('', '## What each one says to do', '');
for (const category of Object.keys(result.byCategory)) {
  if (category === 'exact') continue;
  out.push(`- **${category}** — ${CATEGORIES[category].lever}`);
}

if (Object.keys(result.byLabel).length) {
  out.push('', '## Hand-written labels', '', '| Label | Count |', '|---|---|');
  for (const [label, count] of Object.entries(result.byLabel)) {
    out.push(`| ${label} | ${count} |`);
  }
} else {
  out.push(
    '',
    '## Hand-written labels',
    '',
    'None. Semantic categories — geographic, factual, register — cannot be',
    'derived from the strings and stay invisible until someone labels the rows.',
  );
}

if (result.unlabelled) {
  out.push(
    '',
    `${result.unlabelled} row(s) landed in \`lexical-or-semantic\` with no label. That`,
    'category is a holding pen, not a finding: until those are labelled by hand the',
    'report cannot say what kind of wrong they are.',
  );
}

out.push('', '## One example per category', '');
for (const [category, row] of Object.entries(result.examples)) {
  out.push(`- \`${category}\` — ref ${JSON.stringify(row.reference)}`);
  out.push(`  got ${JSON.stringify(row.hypothesis)}`);
}

console.log(out.join('\n'));
