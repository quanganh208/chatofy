/**
 * client-cpu.ts
 *
 * Collect client-side CPU and frame metrics from a Playwright Page via the
 * Chrome DevTools Protocol (CDP) Performance domain.
 */
import type { Page } from 'playwright';

export interface ClientCpuMetrics {
  /** JS heap used (bytes) */
  jsHeapUsedBytes: number;
  /** JS heap total allocated (bytes) */
  jsHeapTotalBytes: number;
  /** Script duration ms (cumulative) */
  scriptDurationMs: number;
  /** Layout duration ms (cumulative) */
  layoutDurationMs: number;
  /** Task duration ms (cumulative — proxy for main-thread CPU) */
  taskDurationMs: number;
}

/**
 * Take a single CDP Performance snapshot from the given Playwright page.
 * Returns null on error (e.g. CDP not available on non-Chromium).
 */
export async function getClientCpuMetrics(page: Page): Promise<ClientCpuMetrics | null> {
  try {
    const client = await page.context().newCDPSession(page);
    await client.send('Performance.enable');
    const { metrics } = (await client.send('Performance.getMetrics')) as {
      metrics: Array<{ name: string; value: number }>;
    };
    await client.detach();

    const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]));

    return {
      jsHeapUsedBytes: m['JSHeapUsedSize'] ?? 0,
      jsHeapTotalBytes: m['JSHeapTotalSize'] ?? 0,
      scriptDurationMs: (m['ScriptDuration'] ?? 0) * 1000,
      layoutDurationMs: (m['LayoutDuration'] ?? 0) * 1000,
      taskDurationMs: (m['TaskDuration'] ?? 0) * 1000,
    };
  } catch {
    return null;
  }
}
