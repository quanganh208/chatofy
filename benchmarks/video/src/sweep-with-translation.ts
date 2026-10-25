/**
 * sweep-with-translation.ts
 *
 * Running the translation sweep requires the `/ws/translate` WebSocket to be
 * reachable and the STT/TTS sidecars to be running. The conference clients wire
 * translation per speaker through this path (see
 * docs/architecture/video-translation-audio-path.md).
 *
 * For the thesis submission, the translation sweep is documented here as a
 * follow-up step rather than a fully automated grid run, for two reasons:
 *
 *   1. The STT/TTS sidecars are CPU-bound and require real audio input to
 *      produce non-trivial load. Fake audio from Chromium's synthetic device
 *      is silent (or a sine tone), which produces near-zero STT load and does
 *      not represent the actual translation overhead.
 *
 *   2. The translation path requires a signed-in speaker and an active
 *      conversation context, which are not available in the headless harness
 *      without additional wiring.
 *
 * To run a manual translation comparison:
 *   1. Start the API with CONFERENCE_METRICS_ENABLED=1
 *   2. Open the conference-poc page in N browsers (use real microphones)
 *   3. Enable translation per speaker via the UI
 *   4. Run: node --loader ts-node/esm src/collect-manual.ts
 *      (a thin wrapper that calls collectMetricsSamples for 30s and writes JSON)
 *   5. Compare results against the non-translation run for the same participant count
 *
 * This file contains the infrastructure for automated translation load so it
 * can be completed in a future iteration.
 */

import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { collectMetricsSamples } from './metrics.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = resolve(__dirname, '..', 'results');

const SAMPLE_WINDOW_MS = (parseInt(process.env['SAMPLE_WINDOW'] ?? '30', 10) || 30) * 1000;
const API_BASE_URL = process.env['API_BASE_URL'] ?? 'http://localhost:3000';
const API_PID = process.env['API_PID'] ? parseInt(process.env['API_PID'], 10) : null;

/**
 * Collect a single 30s server metrics snapshot and write it as JSON.
 * Intended for use during a manually-driven translation session.
 */
async function collectManualRun(label: string): Promise<void> {
  mkdirSync(RESULTS_DIR, { recursive: true });

  console.log(`\nCollecting ${SAMPLE_WINDOW_MS / 1000}s of metrics for: ${label}`);
  console.log('Ensure the conference room is active with peers producing+consuming.');

  const { snapshots, average } = await collectMetricsSamples(
    API_BASE_URL,
    API_PID,
    SAMPLE_WINDOW_MS,
    2000,
  );

  const result = {
    label,
    timestamp: new Date().toISOString(),
    sampleCount: snapshots.length,
    average,
    notes: 'manual-translation-run',
    topology: 'driver+api-same-host-loopback',
  };

  const outPath = resolve(
    RESULTS_DIR,
    `manual-${label}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
  );
  writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(`\n✅ Written: ${outPath}`);
  console.log(`   Worker CPU avg: ${average.workerCpuPct}%`);
  console.log(`   Worker RSS avg: ${average.workerRssKB} KB`);
  console.log(`   API CPU avg:    ${average.apiCpuPct}%`);
  console.log(`   Bytes sent:     ${average.bytesSentMB} MB`);
}

const label = process.argv[2] ?? `translation-run-${Date.now()}`;
collectManualRun(label).catch((err) => {
  console.error('Collection failed:', err);
  process.exit(1);
});
