import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import pino from 'pino';

const logger = pino({ name: 'exception-filter' });

interface ErrorResponseBody {
  statusCode: number;
  message: string;
  error: string;
  timestamp: string;
  path: string;
}

/**
 * Global exception filter — catches all unhandled exceptions, logs them,
 * and returns a consistent JSON error shape to the client.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    const statusCode =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? ((exception.getResponse() as { message?: string }).message ?? exception.message)
        : 'Internal server error';

    const error = exception instanceof HttpException ? exception.name : 'InternalServerError';

    const body: ErrorResponseBody = {
      statusCode,
      message: typeof message === 'string' ? message : JSON.stringify(message),
      error,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    if (statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      logger.error({ err: exception, req: { url: request.url } }, body.message);
    } else {
      logger.warn({ req: { url: request.url } }, body.message);
    }

    void reply.status(statusCode).send(body);
  }
}
