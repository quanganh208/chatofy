import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import * as mediasoup from 'mediasoup';
import type { types } from 'mediasoup';

/** How long to wait before retrying a worker that failed to (re)spawn. */
const RESPAWN_RETRY_MS = 5_000;

/** Called when the worker dies, BEFORE a replacement is spawned. */
export type WorkerDiedListener = () => void;

/**
 * Owns the single mediasoup Worker every room router runs on.
 *
 * A worker that dies takes every router, transport, producer and consumer on
 * it down with it, so this service tells its listeners (the room registry,
 * which drops every room and closes their sockets) and then spawns a fresh
 * worker. Clients reconnect onto the new one. Until it is up, `getWorker`
 * throws and joins are answered `internal_error`.
 */
@Injectable()
export class ConferenceWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ConferenceWorkerService.name);
  private worker: types.Worker | null = null;
  private readonly diedListeners = new Set<WorkerDiedListener>();
  private respawnTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  async onModuleInit(): Promise<void> {
    await this.spawn();
  }

  onModuleDestroy(): void {
    this.destroyed = true;
    if (this.respawnTimer) clearTimeout(this.respawnTimer);
    this.respawnTimer = null;
    this.worker?.close();
    this.worker = null;
  }

  onWorkerDied(listener: WorkerDiedListener): void {
    this.diedListeners.add(listener);
  }

  getWorker(): types.Worker {
    if (!this.worker) throw new Error('mediasoup Worker not available');
    return this.worker;
  }

  private async spawn(): Promise<void> {
    const worker = await mediasoup.createWorker({
      logLevel: 'warn',
      // 50000–59999 avoids collision with coturn (--min-port 40000 --max-port 49999).
      rtcMinPort: 50000,
      rtcMaxPort: 59999,
    });
    worker.on('died', (error) => this.handleDied(worker, error));
    this.worker = worker;
    this.logger.log(`mediasoup Worker spawned (pid ${worker.pid})`);
  }

  private handleDied(worker: types.Worker, error: Error): void {
    if (this.worker !== worker) return;
    this.logger.error(
      `mediasoup Worker died (pid ${worker.pid}); dropping every room and respawning`,
      error,
    );
    this.worker = null;
    for (const listener of this.diedListeners) {
      try {
        listener();
      } catch (err) {
        this.logger.error('a worker-died listener threw', err);
      }
    }
    this.respawn();
  }

  private respawn(): void {
    if (this.destroyed) return;
    this.spawn().catch((err: unknown) => {
      this.logger.error(
        `mediasoup Worker respawn failed; retrying in ${RESPAWN_RETRY_MS} ms`,
        err,
      );
      if (this.destroyed) return;
      this.respawnTimer = setTimeout(() => {
        this.respawnTimer = null;
        this.respawn();
      }, RESPAWN_RETRY_MS);
    });
  }
}
