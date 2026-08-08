import { Logger } from '@nestjs/common';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Which measurement a row came from.
 *
 * `server` and `client` are the two halves of one turn on the cascade path.
 * `live` is a whole session on the continuous path — a different unit entirely,
 * which is why it is a third source rather than a variant of the first two, and
 * why a reader must filter on this field before comparing anything.
 */
export type MetricsSource = 'server' | 'client' | 'live';

/**
 * Appends one JSON line per measurement, from any source.
 *
 * Extracted rather than copied. The delicate parts here are not the write: they
 * are that the directory is created once instead of per row, that a broken sink
 * warns once per source instead of flooding, and that a failure can never reach
 * the thing being measured. A second copy of those three rules would drift, and
 * the copy that drifted would be the one nobody was reading.
 *
 * Off unless a path is configured: a latency table is something you go and
 * collect, not a file the API grows on every deployment.
 */
export class MetricsJsonlSink {
  /** Directory creation is attempted once, not on every row. */
  private ready?: Promise<void>;
  /**
   * One warning per process PER SOURCE; a broken sink must not flood the log.
   *
   * Split by source deliberately. A single latch meant the first failed write of
   * any kind silenced the warning for the others, so a sink that had stopped
   * accepting one kind of row could look healthy because another kind had
   * already used up the one warning.
   */
  private readonly warned = new Set<MetricsSource>();

  constructor(
    private readonly path: string | undefined,
    private readonly logger: Logger,
  ) {}

  /** Fire-and-forget: a metrics sink must never delay or fail what it measures. */
  append(source: MetricsSource, row: object): void {
    const path = this.path;
    if (!path) return;

    this.ready ??= mkdir(dirname(path), { recursive: true }).then(
      () => undefined,
    );
    void this.ready
      .then(() =>
        appendFile(path, `${JSON.stringify({ source, ...row })}\n`, 'utf8'),
      )
      .catch((err: unknown) => {
        if (this.warned.has(source)) return;
        this.warned.add(source);
        this.logger.warn(
          `${source} metrics disabled — cannot write ${path}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
  }
}
