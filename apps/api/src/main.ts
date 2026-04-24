import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    // Basic logger levels; swap for nestjs-pino integration later
    logger: ['error', 'warn', 'log'],
  });

  // Raw WebSocket adapter (ws) — registered before listen so gateway picks it up
  app.useWebSocketAdapter(new WsAdapter(app));

  // CORS — comma-separated origins from env, fallback to wildcard
  const corsOrigin = process.env.CORS_ORIGIN ?? '*';
  const origins =
    corsOrigin === '*' ? '*' : corsOrigin.split(',').map((o) => o.trim());
  app.enableCors({ origin: origins, credentials: origins !== '*' });

  // Global exception filter — uniform JSON error envelope
  app.useGlobalFilters(new AllExceptionsFilter());

  // Global logging interceptor — req/res duration
  app.useGlobalInterceptors(new LoggingInterceptor());

  const port = parseInt(process.env.PORT ?? '3000', 10);
  await app.listen(port);
}

void bootstrap();
