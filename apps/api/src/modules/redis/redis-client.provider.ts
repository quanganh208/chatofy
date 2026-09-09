import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
} from '@nestjs/common';
import { createClient } from 'redis';

/**
 * The injection token every Redis consumer asks for. A token rather than the
 * concrete client class for the same reason AUTH_ADAPTER is one: consumers name
 * the seam, not the vendor.
 */
export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

/** The shape `REDIS_CLIENT` resolves to. */
export type RedisClient = ReturnType<typeof createClient>;

/**
 * Builds the client and starts connecting WITHOUT blocking the boot.
 *
 * Three separate things keep the API bootable while Redis is down, and all
 * three are load-bearing:
 *
 * 1. `disableOfflineQueue` — a command issued while disconnected rejects
 *    immediately instead of queueing forever. The caller turns that rejection
 *    into a 503 (SessionRefreshService); a queued command would instead hang
 *    the request until its own timeout.
 * 2. The `error` LISTENER — an unhandled `error` *event* on an EventEmitter is
 *    rethrown and kills the process. Reconnect attempts emit one per failure.
 * 3. `.catch()` on `connect()`, NOT `void connect()`. `void` attaches no
 *    rejection handler, so with Redis stopped the ECONNREFUSED rejection is an
 *    unhandled rejection and Node's default `--unhandled-rejections=throw`
 *    terminates the process — defeating the whole point and taking every e2e
 *    suite with it. The error event and a promise rejection are two different
 *    channels; both need handling.
 */
export function createRedisClient(url: string): RedisClient {
  const logger = new Logger('RedisClient');
  const client = createClient({ url, disableOfflineQueue: true });

  client.on('error', (err: Error) => {
    // Logged and swallowed. Reconnection is the client's own job; this listener
    // exists so a transport error does not become an uncaught exception.
    logger.warn(`Redis client error: ${err.message}`);
  });

  client
    .connect()
    .catch((err: Error) =>
      logger.warn(`Redis unavailable at boot: ${err.message}`),
    );

  return client;
}

/** How long a graceful close may take before the socket is torn down instead. */
const QUIT_TIMEOUT_MS = 2000;

/**
 * Closes the connection on shutdown.
 *
 * A separate provider rather than a method on the client because the client is
 * a plain object from `createClient` and Nest only calls lifecycle hooks on
 * providers it constructed. Requires `app.enableShutdownHooks()` in main.ts —
 * without it `onModuleDestroy` never fires on SIGTERM and this is decoration.
 *
 * THE GUARD IS `isReady`, NOT `isOpen`, AND THE WAIT IS BOUNDED. Both halves are
 * load-bearing, and the obvious version of this hangs the process:
 *
 * `isOpen` stays TRUE while the client sits in its reconnect loop, so with Redis
 * unreachable the guard passes and `QUIT` is queued for a connection that will
 * never be ready. It neither resolves nor rejects, so a `try/catch` around it is
 * dead code — and because `enableShutdownHooks()` replaces Node's default SIGTERM
 * kill with `app.close()`, which AWAITS this hook, the process stops responding
 * to SIGTERM entirely and has to be SIGKILLed by the stop timeout. That would
 * happen on every deploy performed DURING a Redis outage — precisely the outage
 * the rest of this design exists to survive.
 *
 * `isReady` is the "connected and able to run a command" flag, which is what
 * `QUIT` actually needs. The timeout then covers the remaining case: ready when
 * checked, gone by the time the command is written.
 */
@Injectable()
export class RedisConnectionLifecycle implements OnModuleDestroy {
  private readonly logger = new Logger(RedisConnectionLifecycle.name);

  constructor(@Inject(REDIS_CLIENT) private readonly client: RedisClient) {}

  async onModuleDestroy(): Promise<void> {
    if (this.client.isReady) {
      try {
        await Promise.race([
          this.client.quit(),
          new Promise((resolve) => setTimeout(resolve, QUIT_TIMEOUT_MS)),
        ]);
      } catch (err) {
        this.logger.warn(
          `Redis did not close cleanly: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Unconditionally, and last: `destroy()` tears the socket down and — the
    // part that matters here — STOPS THE RECONNECT LOOP. Without it a client
    // that was never ready keeps a timer alive and holds the event loop open
    // after everything else has shut down.
    try {
      this.client.destroy();
    } catch {
      // Already destroyed, or never opened. Nothing left to do either way.
    }
  }
}
