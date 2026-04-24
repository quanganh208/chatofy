import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import pino from 'pino';
import { type Observable, tap } from 'rxjs';

const logger = pino({ name: 'http' });

/**
 * Global logging interceptor — records method, URL, status code, and
 * response duration (ms) for every incoming HTTP request.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const ctx = context.switchToHttp();
    const req = ctx.getRequest<FastifyRequest>();
    const { method, url } = req;
    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const ms = Date.now() - start;
          logger.info({ method, url, ms }, `${method} ${url} +${ms}ms`);
        },
        error: (err: unknown) => {
          const ms = Date.now() - start;
          logger.error({ method, url, ms, err }, `${method} ${url} error +${ms}ms`);
        },
      }),
    );
  }
}
