import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { ApiError, ApiErrorResponse, ErrorCode } from '@chatofy/types';
import type { Request, Response } from 'express';
import { ZodValidationException } from 'nestjs-zod';

/**
 * Maps an HTTP status to a stable, client-facing error code.
 * Numeric literals are used (not the HttpStatus enum) because getStatus()
 * returns a plain number; comparing number-vs-enum is an unsafe comparison.
 */
function codeForStatus(status: number): ErrorCode {
  switch (status) {
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 413:
      // Raised by body-parser, not by a route: the request never reached one.
      // VALIDATION_FAILED would be the default and reads as "fix the fields",
      // when the only fix is to send less.
      return 'VALIDATION_FAILED';
    case 429:
      // Reachable since the auth routes gained a rate limit. Without this case
      // a throttled caller is told VALIDATION_FAILED, which reads as "fix your
      // request" when the correct advice is "send it again later".
      return 'RATE_LIMITED';
    default:
      // Any other 4xx is treated as a client/validation error; 5xx is internal.
      return status >= 500 ? 'INTERNAL_ERROR' : 'VALIDATION_FAILED';
  }
}

/**
 * Extracts a human-readable message from an HttpException response payload.
 * Only used for 4xx (5xx is forced generic). The returned message is
 * CLIENT-FACING — never construct 4xx HttpExceptions with raw DB/internal
 * strings (e.g. `new ConflictException(dbError.message)`).
 */
function messageFromHttpException(exception: HttpException): string {
  const res = exception.getResponse();
  if (typeof res === 'string') return res;
  if (typeof res === 'object' && res !== null && 'message' in res) {
    const m = (res as Record<string, unknown>).message;
    return Array.isArray(m) ? m.join(', ') : String(m);
  }
  return exception.message;
}

/**
 * A body-parser size refusal. Identified by its own `type` tag rather than by
 * the status alone, so an unrelated error that happens to carry a 413 is not
 * silently relabelled.
 */
function isPayloadTooLarge(exception: unknown): boolean {
  const e = exception as { type?: unknown; statusCode?: unknown } | null;
  return e?.type === 'entity.too.large' && e?.statusCode === 413;
}

/**
 * Catches ALL exceptions and emits the standard error envelope:
 * `{ success: false, error: { code, message, details? }, meta }`.
 *
 * - HTTP-only: non-HTTP contexts (WebSocket) are logged and skipped so the
 *   filter never calls `switchToHttp()` on a socket.
 * - 5xx / unknown errors return a generic message (no internal/exception text
 *   leaks); the full exception is logged.
 * - Zod validation errors are mapped to field-level `details` (path + message
 *   only — raw zod metadata such as regex patterns is dropped).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    // WebSocket / other contexts are out of scope for the HTTP envelope.
    // Intentional: as a global APP_FILTER this also sees WS context. We log and
    // swallow rather than touch switchToHttp() (which would crash on a socket).
    // The gateway is a placeholder today; a dedicated WS exception contract is
    // deferred until the gateway is implemented.
    if (host.getType() !== 'http') {
      this.logger.error(exception);
      return;
    }

    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // A response may already be partially flushed (e.g. streaming) — avoid
    // ERR_HTTP_HEADERS_SENT by bailing out if headers are already on the wire.
    if (response.headersSent) {
      this.logger.error(exception);
      return;
    }

    let statusCode: number;
    const error: ApiError = { code: 'INTERNAL_ERROR', message: '' };

    if (exception instanceof ZodValidationException) {
      statusCode = exception.getStatus();
      error.code = 'VALIDATION_FAILED';
      error.message = 'Validation failed';
      const res = exception.getResponse() as { errors?: unknown };
      if (Array.isArray(res.errors)) {
        error.details = res.errors.map((issue) => {
          const i = issue as { path?: unknown; message?: unknown };
          const path = Array.isArray(i.path) ? i.path.join('.') : '';
          const message = typeof i.message === 'string' ? i.message : '';
          return { path, message };
        });
      }
    } else if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      error.code = codeForStatus(statusCode);
      // 5xx keeps a generic message; 4xx surfaces the (safe) Nest message.
      error.message =
        statusCode >= 500
          ? 'Internal server error'
          : messageFromHttpException(exception);
    } else if (isPayloadTooLarge(exception)) {
      // body-parser refuses an oversized body in MIDDLEWARE, before any route,
      // guard or pipe runs — which is the whole point of the per-path limits in
      // `narrow-body-limits.ts`. What it throws is a plain Error carrying a
      // status, not an HttpException, so without this branch the honest 413
      // becomes a 500 and the caller is told the server broke when in fact it
      // refused. Not specific to one route: the avatar limit answers through
      // here too.
      statusCode = HttpStatus.PAYLOAD_TOO_LARGE;
      error.code = codeForStatus(statusCode);
      error.message = 'Request body is too large';
    } else {
      statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
      error.code = 'INTERNAL_ERROR';
      error.message = 'Internal server error';
      this.logger.error(exception);
    }

    const body: ApiErrorResponse = {
      success: false,
      error,
      meta: {
        requestId: request.requestId ?? 'unknown',
        timestamp: new Date().toISOString(),
      },
    };

    response.status(statusCode).json(body);
  }
}
