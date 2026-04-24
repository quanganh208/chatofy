import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { WsAdapter } from '@nestjs/platform-ws';
import { ConfigService } from '@nestjs/config';
import pino from 'pino';
import { AppModule } from './app.module.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor.js';
import type { Env } from './config/env.schema.js';

const logger = pino({ name: 'bootstrap' });

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false }), // pino handles logging directly
  );

  const config = app.get(ConfigService<Env, true>);
  const port = config.get('PORT', { infer: true });
  const corsOrigin = config.get('CORS_ORIGIN', { infer: true });

  // CORS — split comma-separated origins or allow all with '*'
  const origins: string | string[] =
    corsOrigin === '*' ? '*' : corsOrigin.split(',').map((o) => o.trim());

  app.enableCors({ origin: origins });

  // Use native ws adapter (not socket.io) for WebSocket gateway
  app.useWebSocketAdapter(new WsAdapter(app));

  // Global filter: catches all unhandled exceptions, returns JSON error shape
  app.useGlobalFilters(new AllExceptionsFilter());

  // Global interceptor: logs request/response duration
  app.useGlobalInterceptors(new LoggingInterceptor());

  await app.listen(port, '0.0.0.0');
  logger.info({ port }, `API listening on port ${port}`);
}

bootstrap().catch((err: unknown) => {
  pino().fatal({ err }, 'Fatal error during bootstrap');
  process.exit(1);
});
