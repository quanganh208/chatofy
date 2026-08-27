import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { WsAdapter } from '@nestjs/platform-ws';
import { json } from 'express';
import { AppModule } from './app.module';
import { DEFAULT_WEB_BASE_URL, type Env } from './config/env.schema';
import { requestIdMiddleware } from './common/middleware/request-id.middleware';
import { getSmtpConfig } from './modules/mail/mail.module';
import { getR2Config } from './modules/storage/storage.module';
import { setupSwagger } from './common/swagger/setup-swagger';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Basic logger levels; swap for nestjs-pino integration later
    logger: ['error', 'warn', 'log'],
  });

  // Bound the avatar routes BEFORE the 12mb parser below, and deliberately not
  // with it. body-parser marks a request it has already read and every later
  // parser skips it, so whichever runs FIRST decides the ceiling — registering
  // this first is what makes the narrower limit the effective one.
  //
  // The zod `max` on the request schema cannot do this job: it runs in a Nest
  // pipe, which is downstream of the parser, so by the time it sees anything the
  // full body has been read and JSON.parsed. 512KB leaves room for base64's ~4/3
  // expansion over the 256KB byte cap the storage module enforces after decoding.
  app.use('/auth/me/avatar', json({ limit: '512kb' }));

  // Raise the JSON body limit so POST /translate can carry base64 audio for a
  // short utterance. Must run before listen so it replaces the default parser.
  app.useBodyParser('json', { limit: '12mb' });

  // Raw WebSocket adapter (ws) — registered before listen so gateway picks it up
  app.useWebSocketAdapter(new WsAdapter(app));

  // Zod-validated env (defaults included) — the single config read path; raw
  // process.env stays for pre-DI construction only (see PrismaService).
  const config = app.get(ConfigService<Env, true>);

  // Production-only mail boot gate. Both SMTP and WEB_BASE_URL are OPTIONAL
  // at the schema level — a deployment that never sends mail should not be
  // stopped from booting over either — but "never sends mail" is not true of
  // production. Left unenforced here, a missing SMTP config silently drops
  // every verification/reset mail (see NoopMailSender), and a default
  // WEB_BASE_URL mails a plausible-looking but wrong link — a broken link a
  // user can report is safer than one that looks right and isn't. Refuse to
  // boot rather than warn: this mirrors AUTH_JWT_SECRET, where there is no
  // "auth off" mode to silently fall back to either.
  if (config.get('NODE_ENV', { infer: true }) === 'production') {
    const smtpMissing = getSmtpConfig(config) === undefined;
    const webBaseUrlIsDefault =
      config.get('WEB_BASE_URL', { infer: true }) === DEFAULT_WEB_BASE_URL;
    if (smtpMissing || webBaseUrlIsDefault) {
      throw new Error(
        'Refusing to boot in production: ' +
          [
            smtpMissing &&
              'SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS are not all set',
            webBaseUrlIsDefault &&
              `WEB_BASE_URL is still the default (${DEFAULT_WEB_BASE_URL})`,
          ]
            .filter(Boolean)
            .join(' and '),
      );
    }

    // Avatars, by contrast, WARN rather than refuse. Deliberately asymmetric with
    // the gate above: mail is how an account is verified and recovered, so a
    // deployment that cannot send it is broken; an avatar is a P2 decoration, and
    // refusing to boot over one would block an unrelated hotfix. The endpoints
    // report the cause themselves with a 4xx whose message survives the error
    // filter — this line is what makes the misconfiguration findable in a log
    // instead of only through a user complaint.
    if (getR2Config(config) === undefined) {
      new Logger('bootstrap').warn(
        'Avatar storage is not configured — R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/' +
          'R2_SECRET_ACCESS_KEY/R2_BUCKET/R2_PUBLIC_BASE_URL must all be set. ' +
          'Avatar upload and removal will be refused; everything else works.',
      );
    }
  }

  // Before anything reads an IP. The auth routes are rate limited per client
  // address, and Express decides what "client address" means from this: with it
  // unset behind a proxy, every request appears to come from the proxy and the
  // limit becomes a shared bucket that one attacker can exhaust for everybody.
  const trustProxyHops = config.get('TRUST_PROXY_HOPS', { infer: true });
  if (trustProxyHops > 0) app.set('trust proxy', trustProxyHops);

  // CORS — comma-separated origins from env, fallback to wildcard
  const corsOrigin = config.get('CORS_ORIGIN', { infer: true });
  const origins =
    corsOrigin === '*' ? '*' : corsOrigin.split(',').map((o) => o.trim());
  app.enableCors({ origin: origins, credentials: origins !== '*' });

  // Correlation id for every HTTP request (Express 5: app.use, not forRoutes).
  app.use(requestIdMiddleware);

  // Global pipeline (filter + interceptors + validation pipe) is registered as
  // DI providers in CommonModule so they also load in module-based e2e tests.

  // OpenAPI / Swagger UI at /docs — non-production only (gated on NODE_ENV).
  const docsMounted = setupSwagger(app);

  const port = config.get('PORT', { infer: true });
  await app.listen(port);

  // The address this process is actually listening on, as a clickable startup
  // log. Deliberately the LOCAL address rather than a configurable public one:
  // behind a proxy the two differ, and a log line does not earn an env var that
  // nothing else reads. The public origin that DOES have to be right is
  // `WEB_BASE_URL`, because mailed links are built from it.
  const baseUrl = `http://localhost:${port}`;
  const logger = new Logger('Bootstrap');
  logger.log(`Application is running on: ${baseUrl}`);
  if (docsMounted) {
    logger.log(`Swagger docs available at: ${baseUrl}/docs`);
  }
}

void bootstrap();
