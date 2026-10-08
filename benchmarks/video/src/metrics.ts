/**
 * metrics.ts
 *
 * Poll the API /conference/metrics HTTP endpoint (Phase 1 tap) and return a
 * typed snapshot. Also polls OS-level CPU/memory for the API process via
 * pidusage if a PID is available.
 */
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

export interface ServerMetrics {
  timestamp: number;
  cpuUserMs: number;
  maxRssBytes: number;
  bytesSent: number;
  bytesReceived: number;
  transportCount: number;
  producerCount: number;
  consumerCount: number;
}

export interface OsMetrics {
  /** CPU % of the API process (0-100 × num CPUs) */
  cpuPercent: number;
  /** RSS memory of the API process in bytes */
  memoryBytes: number;
}

export interface FullMetricsSnapshot {
  server: ServerMetrics | null;
  os: OsMetrics | null;
  collectedAt: number;
}

/** Poll GET /conference/metrics once. Returns null on error. */
export async function pollServerMetrics(apiBaseUrl: string): Promise<ServerMetrics | null> {
  try {
    const url = `${apiBaseUrl}/conference/metrics`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) {
      console.warn(`[metrics] /conference/metrics returned ${resp.status}`);
      return null;
    }
    const body = (await resp.json()) as Record<string, unknown>;
    if ('error' in body || 'status' in body) {
      console.warn('[metrics] Server metrics not ready yet:', body);
      return null;
    }
    return body as unknown as ServerMetrics;
  } catch (err) {
    console.warn(
      '[metrics] Failed to poll server metrics:',
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

/** Poll process CPU/memory via pidusage. Returns null if pid is unknown. */
export async function pollOsMetrics(pid: number | null): Promise<OsMetrics | null> {
  if (pid === null) return null;
  try {
    // pidusage is a CommonJS module
    const pidusage = require('pidusage') as (
      pid: number,
    ) => Promise<{ cpu: number; memory: number }>;
    const stat = await pidusage(pid);
    return { cpuPercent: stat.cpu, memoryBytes: stat.memory };
  } catch {
    return null;
  }
}

/**
 * Collect a single snapshot from both sources.
 */
export async function collectMetrics(
  apiBaseUrl: string,
  apiPid: number | null,
): Promise<FullMetricsSnapshot> {
  const [server, os] = await Promise.all([pollServerMetrics(apiBaseUrl), pollOsMetrics(apiPid)]);
  return { server, os, collectedAt: Date.now() };
}

/**
 * Collect N samples spaced intervalMs apart and return the averaged values.
 * Used to produce a steady-state measurement over the sample window.
 */
export async function collectMetricsSamples(
  apiBaseUrl: string,
  apiPid: number | null,
  sampleWindowMs: number,
  sampleIntervalMs = 2000,
): Promise<{ snapshots: FullMetricsSnapshot[]; average: AveragedMetrics }> {
  const snapshots: FullMetricsSnapshot[] = [];
  const samples = Math.max(1, Math.floor(sampleWindowMs / sampleIntervalMs));

  for (let i = 0; i < samples; i++) {
    const snap = await collectMetrics(apiBaseUrl, apiPid);
    snapshots.push(snap);
    if (i < samples - 1) {
      await sleep(sampleIntervalMs);
    }
  }

  return { snapshots, average: averageSnapshots(snapshots) };
}

export interface AveragedMetrics {
  workerCpuPct: number;
  workerRssKB: number;
  apiCpuPct: number;
  apiMemMB: number;
  bytesSentMB: number;
  bytesRecvMB: number;
  transportCount: number;
  producerCount: number;
  consumerCount: number;
}

function averageSnapshots(snapshots: FullMetricsSnapshot[]): AveragedMetrics {
  const valid = snapshots.filter((s) => s.server !== null);
  const validOs = snapshots.filter((s) => s.os !== null);

  const avg = <T>(arr: T[], fn: (x: T) => number): number =>
    arr.length === 0 ? 0 : arr.reduce((sum, x) => sum + fn(x), 0) / arr.length;

  // Worker CPU: each cpuUserMs value is a 2s delta; express as fraction of 2000ms = %
  const workerCpuPct = avg(valid, (s) => (s.server!.cpuUserMs / 2000) * 100);
  const workerRssKB = avg(valid, (s) => s.server!.maxRssBytes / 1024);
  const apiCpuPct = avg(validOs, (s) => s.os!.cpuPercent);
  const apiMemMB = avg(validOs, (s) => s.os!.memoryBytes / (1024 * 1024));

  // Use last snapshot for cumulative byte counters (they accumulate over the run)
  const lastServer = valid.at(-1)?.server ?? null;
  const bytesSentMB = lastServer ? lastServer.bytesSent / (1024 * 1024) : 0;
  const bytesRecvMB = lastServer ? lastServer.bytesReceived / (1024 * 1024) : 0;
  const transportCount = lastServer?.transportCount ?? 0;
  const producerCount = lastServer?.producerCount ?? 0;
  const consumerCount = lastServer?.consumerCount ?? 0;

  return {
    workerCpuPct: round2(workerCpuPct),
    workerRssKB: round2(workerRssKB),
    apiCpuPct: round2(apiCpuPct),
    apiMemMB: round2(apiMemMB),
    bytesSentMB: round2(bytesSentMB),
    bytesRecvMB: round2(bytesRecvMB),
    transportCount,
    producerCount,
    consumerCount,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
