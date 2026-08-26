import { INestApplication, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { appInfo } from '../app-info';
import { Env } from '../../config/env.schema';

/**
 * Mounts Swagger UI at `/docs` in non-production environments only.
 *
 * Gated on NODE_ENV: `/docs` is not mounted when NODE_ENV === 'production'
 * (prod/docker set NODE_ENV=production). `cleanupOpenApiDoc` post-processes the
 * generated document so `createZodDto` schemas render correctly (nestjs-zod v5
 * removed the old `patchNestJsSwagger` monkeypatch).
 *
 * Returns `true` when Swagger UI was mounted so the caller can log the full
 * docs URL once the listen port is known.
 */
export function setupSwagger(app: INestApplication): boolean {
  const logger = new Logger('Swagger');
  const config = app.get(ConfigService<Env, true>);

  if (config.get('NODE_ENV', { infer: true }) === 'production') {
    logger.log('Swagger disabled in production — /docs not mounted');
    return false;
  }

  const port = config.get('PORT', { infer: true });

  const builder = new DocumentBuilder()
    .setTitle(appInfo.name)
    .setDescription(describeApi(appInfo.description))
    .setVersion(appInfo.version)
    .addServer(`http://localhost:${port}`, 'This process')
    .addBearerAuth({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
      description:
        'Access token from `POST /auth/login` or `POST /auth/google`. Paste the token alone — Swagger adds the `Bearer ` prefix.',
    })
    .addTag(
      'auth',
      'Register, verify, sign in, reset a password, and read or update the caller’s own profile.',
    )
    .addTag(
      'translate',
      'Turn-based speech translation, plus the voices the running TTS backend offers.',
    )
    .addTag('health', 'Liveness probe. Not enveloped.')
    .addTag('meta', 'Service identity at the bare origin.')
    .build();

  const document = SwaggerModule.createDocument(app, builder);
  SwaggerModule.setup('docs', app, cleanupOpenApiDoc(document), {
    // Without this, the token entered in "Authorize" is dropped on every
    // reload — and most of this document is behind a bearer token, so the
    // first thing anyone reads it for is the thing it kept losing.
    swaggerOptions: { persistAuthorization: true },
  });
  logger.log('Swagger UI mounted at /docs');
  return true;
}

/**
 * The document-level description: the three things that are true of every route
 * and therefore belong nowhere in particular — the response envelope, the
 * bearer token, and the WebSocket surface OpenAPI cannot describe at all.
 *
 * Without the last of those, this document reads as the whole API while the
 * real-time path — the one the apps spend most of their time on — is invisible.
 */
function describeApi(summary: string): string {
  return [
    summary,
    '',
    '### Response envelope',
    '',
    'Every HTTP response except `GET /health` is wrapped. Success is',
    '`{ success: true, data, meta }`; failure is `{ success: false, error, meta }`',
    'carried with a real 4xx/5xx status. Branch on `success`, read `error.code`',
    'for a stable machine-readable reason, and quote `meta.requestId` (echoed as',
    'the `x-request-id` response header) when reporting a fault.',
    '',
    '### Authentication',
    '',
    'Routes are authenticated by default — a global guard applies, and only the',
    'routes documented without a padlock are public. Send the access token from',
    '`POST /auth/login` or `POST /auth/google` as `Authorization: Bearer <token>`.',
    '',
    '### WebSocket',
    '',
    'Real-time translation is **not** in this document: OpenAPI describes',
    'request/response routes, and that surface is a message stream. It lives at',
    '`ws://<host>/ws/translate`, authenticated with the same access token, and',
    'the first message picks the mode — `client.session.start` for the turn-based',
    'cascade, `client.live.start` for continuous speech-to-speech. The message',
    'contracts are the zod schemas in `@chatofy/types` (`clientEventSchema`,',
    '`liveClientEventSchema` and their server counterparts).',
  ].join('\n');
}
