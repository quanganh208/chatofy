// Repair the display-fidelity set through the SHIPPING repair path, and report
// what the divergence guard makes of each result.
//
// Step 2 of 3; see `dump_display_hypotheses.py` for the sequence.
//
// It drives `GeminiTranslationProvider.repair()` itself rather than re-declaring
// the prompt — the same rule `benchmarks/prompt-injection/run.mjs` states and for
// the same reason: a harness carrying its own copy of the instruction keeps
// passing after the real one has drifted, and would have nothing to say about
// production.
//
// This spends real Gemini quota on `gemma-4-31b-it` (14,400 requests/day), so it
// paces itself and is never wired into `pnpm test` or CI.
//
//     node scripts/repair_display_hypotheses.mjs [--gap-ms 1500]
//
// Two things come out. `data/display-repaired.jsonl` feeds the fidelity scorer.
// The divergence table printed at the end is the CALIBRATION for
// `MAX_REPAIR_DIVERGENCE`: every row here is a legitimate repair of real audio,
// so the threshold has to pass all of them.
import { readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  GeminiTranslationProvider,
  repairDivergence,
} from '../../../packages/ai-providers/dist/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BENCH = resolve(HERE, '..');
const REPO = resolve(BENCH, '../..');

const IN = resolve(BENCH, 'data/display-hypotheses.jsonl');
const OUT = resolve(BENCH, 'data/display-repaired.jsonl');

/** Gemma's per-minute ceiling is generous; this is polite rather than required. */
const DEFAULT_GAP_MS = 1500;

function parseArgs(argv) {
  const args = { gapMs: DEFAULT_GAP_MS };
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const raw = argv[i + 1];
    if (raw === undefined) throw new Error(`${flag} needs a value`);
    if (flag !== '--gap-ms') throw new Error(`unknown argument: ${flag}`);
    const value = Number(raw);
    // `Number('2x')` is NaN and every comparison against it is false, so a typo
    // would otherwise sail through and pace the run at NaN milliseconds.
    if (!Number.isFinite(value) || value < 0) throw new Error('--gap-ms needs a number >= 0');
    args.gapMs = value;
  }
  return args;
}

/** The API key the api itself uses; never printed. Same resolution as the injection runner. */
function readApiKey() {
  const fromEnv = process.env.GEMINI_API_KEY?.trim();
  if (fromEnv) return fromEnv;

  const envPath = resolve(REPO, 'apps/api/.env');
  let file = '';
  try {
    file = readFileSync(envPath, 'utf8');
  } catch (err) {
    if (err?.code !== 'ENOENT') throw err;
    throw new Error(`set GEMINI_API_KEY, or put it in ${envPath}`);
  }
  const key = /^GEMINI_API_KEY=(.*)$/m.exec(file)?.[1]?.trim();
  if (!key) throw new Error(`GEMINI_API_KEY not found in ${envPath}`);
  return key;
}

const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];

const args = parseArgs(process.argv.slice(2));
const rows = readFileSync(IN, 'utf8')
  .split('\n')
  .filter((line) => line.trim())
  .map((line) => JSON.parse(line));

const provider = new GeminiTranslationProvider({ apiKey: readApiKey() });
const out = [];

for (const row of rows) {
  const started = Date.now();
  let repaired = null;
  let error;
  try {
    const result = await provider.repair({ text: row.raw, language: row.language });
    repaired = result.text;
  } catch (err) {
    // A quota rejection is not a result. Recorded as one that failed, which is
    // also exactly what the product does with it: show the raw text.
    error = String(err?.message ?? err).slice(0, 120);
  }
  const ms = Date.now() - started;
  const divergence = repaired === null ? null : repairDivergence(row.raw, repaired, row.language);

  out.push({ ...row, repaired, error, ms, divergence });
  console.log(
    `${row.id.padEnd(16)} ${String(ms).padStart(6)}ms ` +
      `${divergence === null ? '  ERROR' : `res=${divergence.residual.toFixed(4)} ex=${String(divergence.exemptedOps).padStart(2)}`}` +
      `  ${JSON.stringify(repaired ?? error)}`,
  );
  await sleep(args.gapMs);
}

writeFileSync(OUT, out.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8');

const scored = out.filter((row) => row.divergence !== null);
const residuals = scored.map((row) => row.divergence.residual).sort((a, b) => a - b);
const latencies = scored.map((row) => row.ms).sort((a, b) => a - b);

console.log(`\n=== divergence over ${scored.length} legitimate repairs ===`);
if (residuals.length) {
  console.log(
    `  residual  min ${residuals[0].toFixed(4)}  median ${quantile(residuals, 0.5).toFixed(4)}` +
      `  p90 ${quantile(residuals, 0.9).toFixed(4)}  max ${residuals[residuals.length - 1].toFixed(4)}`,
  );
  console.log(`  exactly 0 ${residuals.filter((r) => r === 0).length}/${residuals.length}`);
  console.log(
    `  latency   median ${quantile(latencies, 0.5)}ms  max ${latencies[latencies.length - 1]}ms`,
  );
}
console.log(`  errors    ${out.length - scored.length}/${out.length}`);
console.log(`\n${out.length} rows → ${OUT}`);
