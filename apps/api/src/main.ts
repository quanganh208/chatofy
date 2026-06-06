import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { WsAdapter } from '@nestjs/platform-ws';
import { AppModule } from './app.module';
import { requestIdMiddleware } from './common/middleware/request-id.middleware';
import { setupSwagger } from './common/swagger/setup-swagger';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Basic logger levels; swap for nestjs-pino integration later
    logger: ['error', 'warn', 'log'],
  });

  // Raise the JSON body limit so POST /translate can carry base64 audio for a
  // short utterance. Must run before listen so it replaces the default parser.
  app.useBodyParser('json', { limit: '12mb' });

  // Raw WebSocket adapter (ws) — registered before listen so gateway picks it up
  app.useWebSocketAdapter(new WsAdapter(app));

  // CORS — comma-separated origins from env, fallback to wildcard
  const corsOrigin = process.env.CORS_ORIGIN ?? '*';
  const origins =
    corsOrigin === '*' ? '*' : corsOrigin.split(',').map((o) => o.trim());
  app.enableCors({ origin: origins, credentials: origins !== '*' });

  // Correlation id for every HTTP request (Express 5: app.use, not forRoutes).
  app.use(requestIdMiddleware);

  // Global pipeline (filter + interceptors + validation pipe) is registered as
  // DI providers in CommonModule so they also load in module-based e2e tests.

  // OpenAPI / Swagger UI at /docs — non-production only (gated on NODE_ENV).
  const docsMounted = setupSwagger(app);

  const port = parseInt(process.env.PORT ?? '3000', 10);
  await app.listen(port);

  // Surface the resolved listen URL (and docs URL when mounted) as a clickable
  // startup log. Prefer APP_URL when set (proxied/containerised deployments).
  const baseUrl = process.env.APP_URL ?? `http://localhost:${port}`;
  const logger = new Logger('Bootstrap');
  logger.log(`Application is running on: ${baseUrl}`);
  if (docsMounted) {
    logger.log(`Swagger docs available at: ${baseUrl}/docs`);
  }
}

void bootstrap();
