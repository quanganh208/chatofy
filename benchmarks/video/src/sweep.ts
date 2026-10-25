/**
 * sweep.ts
 *
 * Iterates the full benchmark grid:
 *   participants (2, 3, 4, 6) × resolution (360p30, 720p30, 720p60)
 * = 24 cells (2 repeats each = 48 runs)
 *
 * After all runs, writes summary.csv with one averaged row per cell.
 *
 * Usage:
 *   pnpm sweep
 *   SWEEP_REPEATS=1 pnpm sweep          # faster smoke
 *   SWEEP_COUNTS=2,3 pnpm sweep         # subset
 *
 * Env:
 *   SWEEP_REPEATS      Runs per cell (default: 2)
 *   SWEEP_COUNTS       Comma-sep participant counts (default: 2,3,4,6)
 *   SWEEP_RESOLUTIONS  Comma-sep resolutions (default: 360p30,720p30,720p60)
 *   API_BASE_URL / API_WS_URL / BENCH_EMAIL / BENCH_PASSWORD / SAMPLE_WINDOW  (see run-once.ts)
 */
import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runOnce, type Resolution, type RunResult } from './run-once.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = resolve(__dirname, '..', 'results');

// ─── Grid config ──────────────────────────────────────────────────────────────

const REPEATS = parseInt(process.env['SWEEP_REPEATS'] ?? '2', 10);
const COUNTS: number[] = (process.env['SWEEP_COUNTS'] ?? '2,3,4,6')
  .split(',')
  .map(Number)
  .filter((n) => n > 0);
const RESOLUTIONS: Resolution[] = (process.env['SWEEP_RESOLUTIONS'] ?? '360p30,720p30,720p60')
  .split(',')
  .filter((r): r is Resolution => ['360p30', '720p30', '720p60'].includes(r));

// ─── CSV schema ───────────────────────────────────────────────────────────────

type CsvRow = {
  participants: number;
  resolution: Resolution;
  fps: number;
  run: number;
  workerCpuPct: number;
  workerRssKB: number;
  apiCpuPct: number;
  apiMemMB: number;
  bytesSentMB: number;
  bytesRecvMB: number;
  notes: string;
};

const CSV_HEADERS: (keyof CsvRow)[] = [
  'participants',
  'resolution',
  'fps',
  'run',
  'workerCpuPct',
  'workerRssKB',
  'apiCpuPct',
  'apiMemMB',
  'bytesSentMB',
  'bytesRecvMB',
  'notes',
];

function resultToCsvRow(result: RunResult, run: number): CsvRow {
  const fpsMap: Record<Resolution, number> = {
    '360p30': 30,
    '720p30': 30,
    '720p60': 60,
  };
  return {
    participants: result.config.participantCount,
    resolution: result.config.resolution,
    fps: fpsMap[result.config.resolution],
    run,
    workerCpuPct: result.server.workerCpuPct,
    workerRssKB: result.server.workerRssKB,
    apiCpuPct: result.server.apiCpuPct,
    apiMemMB: result.server.apiMemMB,
    bytesSentMB: result.server.bytesSentMB,
    bytesRecvMB: result.server.bytesRecvMB,
    notes: result.notes,
  };
}

function rowsToCsv(rows: CsvRow[]): string {
  const header = CSV_HEADERS.join(',');
  const lines = rows.map((r) => CSV_HEADERS.map((k) => String(r[k])).join(','));
  return [header, ...lines].join('\n') + '\n';
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  mkdirSync(RESULTS_DIR, { recursive: true });

  const totalCells = COUNTS.length * RESOLUTIONS.length;
  const totalRuns = totalCells * REPEATS;
  console.log(`\n═══ Video SFU Capacity Sweep ═══`);
  console.log(`  Grid: ${COUNTS.join(',')} participants × ${RESOLUTIONS.join(',')}`);
  console.log(`  Repeats: ${REPEATS} per cell`);
  console.log(`  Total runs: ${totalRuns}`);

  const csvRows: CsvRow[] = [];
  let runIndex = 0;

  for (const count of COUNTS) {
    for (const res of RESOLUTIONS) {
      const cellResults: RunResult[] = [];

      for (let rep = 0; rep < REPEATS; rep++) {
        runIndex++;
        console.log(
          `\n[${runIndex}/${totalRuns}] ${count}p × ${res} — repeat ${rep + 1}/${REPEATS}`,
        );

        try {
          const result = await runOnce({
            participantCount: count,
            resolution: res,
            runIndex: rep,
          });
          cellResults.push(result);
          csvRows.push(resultToCsvRow(result, rep + 1));
        } catch (err) {
          console.error(
            `  ✗ Run failed for ${count}p × ${res} repeat ${rep + 1}:`,
            err instanceof Error ? err.message : String(err),
          );
          // Write a placeholder row so the CSV has a full grid
          csvRows.push({
            participants: count,
            resolution: res,
            fps: res.endsWith('60') ? 60 : 30,
            run: rep + 1,
            workerCpuPct: 0,
            workerRssKB: 0,
            apiCpuPct: 0,
            apiMemMB: 0,
            bytesSentMB: 0,
            bytesRecvMB: 0,
            notes: `ERROR: ${err instanceof Error ? err.message : String(err)}`,
          });
        }

        // Brief pause between runs to let the API shed connections
        await sleep(3000);
      }

      if (cellResults.length > 0) {
        console.log(
          `  Cell avg: CPU=${average(cellResults, (r) => r.server.workerCpuPct).toFixed(1)}% RSS=${average(cellResults, (r) => r.server.workerRssKB).toFixed(0)}KB`,
        );
      }
    }
  }

  // ── Write summary.csv ─────────────────────────────────────────────────────
  const csvPath = resolve(RESULTS_DIR, 'summary.csv');
  writeFileSync(csvPath, rowsToCsv(csvRows));
  console.log(`\n✅ Sweep complete. Summary: ${csvPath}`);
  console.log(`   Rows: ${csvRows.length}`);
}

function average<T>(arr: T[], fn: (x: T) => number): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, x) => s + fn(x), 0) / arr.length;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err) => {
  console.error('Sweep failed:', err);
  process.exit(1);
});
