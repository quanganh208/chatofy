// Did the shipped translator render the specific term a row expects?
//
//   node benchmarks/error-analysis/term-rendering.mjs rows.jsonl [rows.jsonl…]
//   node benchmarks/error-analysis/term-rendering.mjs --strict rows.jsonl
//
// This is NOT `glossary-adherence.mjs` in a smaller coat. That scorer answers
// "when the source contained an operator's glossary term, did the output carry
// its counterpart" — a claim about a dictionary. This answers a narrower,
// per-row claim that has nothing to do with a glossary: did THIS transcript
// come back matching a hand-written expectation (an "AI" or a "who" form),
// which is the property the ASR-note rows exist to measure and a glossary file
// says nothing about. It keeps its own scorer rather than growing a mode onto
// that one, because the two questions are answered from different fields —
// `mustMatch` here, glossary containment there — and a shared flag between
// them would only teach a reader to mistrust both.
//
// Reads rows already carrying a `hypothesis` (written by `translate-rows.mjs`)
// plus a `mustMatch` regex source and an optional `mustNotMatch`. Never
// translates, never writes.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** JSONL in, one object per line, with the same per-line error reporting every reader here uses. */
export function readRows(path) {
  return readFileSync(path, 'utf8')
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
}

/**
 * One row's verdict.
 *
 * `mustMatch` and `mustNotMatch` are regex SOURCES, not `RegExp` objects — rows
 * arrive from JSON, which cannot carry one — and neither is given flags: a row
 * that needs case-insensitivity writes it into the pattern itself (`(?:AI|ai)`
 * rather than `/ai/i`), because the difference between "AI" and "ai" is
 * exactly what half of these rows exist to tell apart, and a blanket `i` flag
 * would erase it silently for every row, not just the ones that want it.
 */
export function scoreRow(row) {
  if (!row.mustMatch) {
    throw new Error(`row ${row.id ?? '(no id)'} carries no mustMatch`);
  }
  const hypothesis = row.hypothesis ?? '';
  const must = new RegExp(row.mustMatch, 'u');
  const mustNot = row.mustNotMatch ? new RegExp(row.mustNotMatch, 'u') : null;
  const pass = must.test(hypothesis) && !(mustNot && mustNot.test(hypothesis));
  return { id: row.id, pass, hypothesis, mustMatch: row.mustMatch, mustNotMatch: row.mustNotMatch };
}

/** Every row's verdict, plus the totals a caller reports from. */
export function scoreRows(rows) {
  const results = rows.map(scoreRow);
  return {
    results,
    total: results.length,
    passed: results.filter((r) => r.pass).length,
    failures: results.filter((r) => !r.pass),
  };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const argv = process.argv.slice(2);
  const strict = argv.includes('--strict');
  const paths = argv.filter((arg) => arg !== '--strict');
  if (!paths.length) {
    throw new Error('usage: term-rendering.mjs [--strict] <rows.jsonl> [rows.jsonl…]');
  }

  let total = 0;
  let passed = 0;
  const failures = [];
  for (const path of paths) {
    const {
      total: pathTotal,
      passed: pathPassed,
      failures: pathFailures,
    } = scoreRows(readRows(path));
    total += pathTotal;
    passed += pathPassed;
    for (const failure of pathFailures) failures.push({ path, ...failure });
  }

  console.log(`${passed}/${total} rows rendered their expected term.`);
  if (failures.length) {
    console.log('\nFailed:');
    for (const f of failures) {
      const notClause = f.mustNotMatch ? ` mustNotMatch=${f.mustNotMatch}` : '';
      console.log(
        `  ${f.path}  ${f.id}  mustMatch=${f.mustMatch}${notClause}  got=${JSON.stringify(f.hypothesis)}`,
      );
    }
  }

  if (strict && failures.length) process.exit(1);
}
