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
 *
 * Controllers always return raw payloads; there is no envelope-detection
 * heuristic (a `success` field on domain data must not suppress wrapping).
 */
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
