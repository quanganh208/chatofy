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

  const builder = new DocumentBuilder()
    .setTitle(appInfo.name)
    .setDescription(appInfo.description)
    .setVersion(appInfo.version)
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, builder);
  SwaggerModule.setup('docs', app, cleanupOpenApiDoc(document));
  logger.log('Swagger UI mounted at /docs');
  return true;
}
