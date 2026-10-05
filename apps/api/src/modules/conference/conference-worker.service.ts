import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import * as mediasoup from 'mediasoup';
import type { types } from 'mediasoup';

/** One Worker powers one Router per room. For a PoC, a single worker is enough. */
@Injectable()
export class ConferenceWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ConferenceWorkerService.name);
  private worker: types.Worker | null = null;

  async onModuleInit(): Promise<void> {
    this.worker = await mediasoup.createWorker({
      logLevel: 'warn',
      rtcMinPort: 40000,
      rtcMaxPort: 49999,
    });

    this.worker.on('died', (error) => {
      this.logger.error('mediasoup Worker died', error);
      // In production we would restart; for PoC just log.
    });

    this.logger.log(`mediasoup Worker spawned (pid ${this.worker.pid})`);
  }

  async onModuleDestroy(): Promise<void> {
    this.worker?.close();
  }

  getWorker(): types.Worker {
    if (!this.worker) throw new Error('mediasoup Worker not initialised');
    return this.worker;
  }
}
