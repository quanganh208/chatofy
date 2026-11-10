import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { ApiSuccess } from '@chatofy/types';
import type { Request } from 'express';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/**
 * Wraps every successful HTTP response in the standard success envelope:
 * `{ success: true, data, meta: { requestId, timestamp } }`.
 *
 * Skipped for:
 * - non-HTTP execution contexts (WebSocket) — returns the stream untouched so
 *   the gateway is never forced through `switchToHttp()`.
 * - `/health*` routes — infra probes stay raw for body-shape stability.
 * - `/billing/webhooks/*` — payment providers judge the reply by its exact
 *   bytes: SePay counts a delivery as received only when the body is exactly
 *   `{"success":true}`, and retries an enveloped one until it gives up.
 *
 * Controllers always return raw payloads; there is no envelope-detection
 * heuristic (a `success` field on domain data must not suppress wrapping).
 */
/** Provider callbacks, answered in the provider's own contract rather than ours. */
const WEBHOOK_PATH_PREFIX = '/billing/webhooks/';

@Injectable()
export class TransformInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const req = context.switchToHttp().getRequest<Request>();
    // Exclude health probes only — exact `/health` or sub-paths, not `/healthX`.
    if (req.path === '/health' || req.path.startsWith('/health/')) {
      return next.handle();
    }
    // Lower-cased because Express routes case-insensitively: a provider
    // configured with `/Billing/Webhooks/...` reaches the same handler and
    // must get the same raw reply.
    if (req.path.toLowerCase().startsWith(WEBHOOK_PATH_PREFIX)) {
      return next.handle();
    }

    const requestId = req.requestId ?? 'unknown';

    return next.handle().pipe(
      map((data): ApiSuccess<unknown> => ({
        success: true,
        data,
        meta: { requestId, timestamp: new Date().toISOString() },
      })),
    );
  }
}
