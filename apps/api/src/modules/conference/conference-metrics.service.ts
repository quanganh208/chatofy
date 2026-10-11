import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConferenceWorkerService } from './conference-worker.service';
import { ConferenceRoomRegistry } from './conference-room-registry.service';

export interface MetricsSnapshot {
  /** Monotonic timestamp (ms) when this snapshot was taken */
  timestamp: number;
  /** mediasoup worker CPU user time (ms) — delta from previous snapshot */
  cpuUserMs: number;
  /** mediasoup worker RSS memory (bytes) — from ru_maxrss */
  maxRssBytes: number;
  /** Sum of bytesWritten across ALL active transports */
  bytesSent: number;
  /** Sum of bytesReceived across ALL active transports */
  bytesReceived: number;
  /** Total number of open WebRTC transports */
  transportCount: number;
  /** Total producers across all rooms */
  producerCount: number;
  /** Total consumers across all rooms */
  consumerCount: number;
}

/**
 * Lightweight SFU metrics tap — gated by CONFERENCE_METRICS_ENABLED=1.
 *
 * Polls worker.getResourceUsage() every 2 seconds when enabled and exposes a
 * current snapshot for the benchmark harness to poll via HTTP GET
 * /conference/metrics. No-ops entirely when the env flag is absent so normal
 * dev/production is unaffected.
 */
@Injectable()
export class ConferenceMetricsService implements OnModuleDestroy {
  private readonly logger = new Logger(ConferenceMetricsService.name);
  private readonly enabled: boolean;

  private interval: ReturnType<typeof setInterval> | null = null;
  private snapshot: MetricsSnapshot | null = null;
  private lastCpuUserUs = 0; // microseconds — getResourceUsage returns µs

  constructor(
    private readonly workerService: ConferenceWorkerService,
    private readonly registry: ConferenceRoomRegistry,
  ) {
    this.enabled =
      process.env['CONFERENCE_METRICS_ENABLED'] === '1' ||
      process.env['CONFERENCE_METRICS_ENABLED'] === 'true';

    if (this.enabled) {
      this.logger.log('Conference metrics collection ENABLED (every 2s)');
      this.interval = setInterval(() => void this.collect(), 2000);
    }
  }

  onModuleDestroy(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getSnapshot(): MetricsSnapshot | null {
    return this.snapshot;
  }

  private async collect(): Promise<void> {
    try {
      const worker = this.workerService.getWorker();
      const usage = await worker.getResourceUsage();

      const nowMs = Date.now();
      // ru_utime is user CPU time in microseconds
      const cpuUserUs = usage.ru_utime;
      const cpuUserDeltaUs = cpuUserUs - this.lastCpuUserUs;
      this.lastCpuUserUs = cpuUserUs;

      // ru_maxrss: on Linux, kilobytes; on macOS/Windows, bytes.
      // mediasoup normalises to bytes in its TypeScript typings (v3).
      const maxRssBytes = usage.ru_maxrss;

      // Aggregate transport stats from all rooms
      let bytesSent = 0;
      let bytesReceived = 0;
      let transportCount = 0;
      let producerCount = 0;
      let consumerCount = 0;

      const rooms = this.registry.getAllRooms();
      for (const room of rooms) {
        for (const peer of room.peers.values()) {
          // Count producers/consumers
          producerCount += peer.producers.size;
          consumerCount += peer.consumers.size;

          // sendTransport stats
          if (peer.sendTransport) {
            transportCount++;
            const statsArr = await peer.sendTransport.getStats();
            for (const stat of statsArr) {
              if ('bytesSent' in stat && typeof stat.bytesSent === 'number') {
                bytesSent += stat.bytesSent;
              }
              if (
                'bytesReceived' in stat &&
                typeof stat.bytesReceived === 'number'
              ) {
                bytesReceived += stat.bytesReceived;
              }
            }
          }

          // recvTransport stats
          if (peer.recvTransport) {
            transportCount++;
            const statsArr = await peer.recvTransport.getStats();
            for (const stat of statsArr) {
              if ('bytesSent' in stat && typeof stat.bytesSent === 'number') {
                bytesSent += stat.bytesSent;
              }
              if (
                'bytesReceived' in stat &&
                typeof stat.bytesReceived === 'number'
              ) {
                bytesReceived += stat.bytesReceived;
              }
            }
          }
        }
      }

      this.snapshot = {
        timestamp: nowMs,
        cpuUserMs: Math.round(cpuUserDeltaUs / 1000),
        maxRssBytes,
        bytesSent,
        bytesReceived,
        transportCount,
        producerCount,
        consumerCount,
      };
    } catch (err) {
      this.logger.error('Metrics collection failed', err);
    }
  }
}
