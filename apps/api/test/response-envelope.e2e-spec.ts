import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WsAdapter } from '@nestjs/platform-ws';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { requestIdMiddleware } from '../src/common/middleware/request-id.middleware';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Boots the full AppModule so the APP_* providers (TransformInterceptor,
 * AllExceptionsFilter, ZodValidationPipe) are exercised. PrismaService is mocked
 * (no DB). The bootstrap-level request-id middleware is replicated via app.use,
 * mirroring main.ts.
 */
describe('Response envelope (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({ $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useWebSocketAdapter(new WsAdapter(app));
    app.use(requestIdMiddleware);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('wraps a successful response in the envelope + sets x-request-id', async () => {
    const res = await request(app.getHttpServer())
      .get('/auth/providers')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({ provider: expect.any(String) });
    expect(res.body.meta.requestId).toEqual(expect.any(String));
    expect(res.body.meta.timestamp).toEqual(expect.any(String));
    expect(res.headers['x-request-id']).toBe(res.body.meta.requestId);
  });

  it('echoes a valid inbound x-request-id', async () => {
    const res = await request(app.getHttpServer())
      .get('/auth/providers')
      .set('x-request-id', 'trace-abc123')
      .expect(200);
    expect(res.body.meta.requestId).toBe('trace-abc123');
    expect(res.headers['x-request-id']).toBe('trace-abc123');
  });

  it('returns the error envelope for unknown routes', async () => {
    const res = await request(app.getHttpServer())
      .get('/does-not-exist')
      .expect(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.meta.requestId).toEqual(expect.any(String));
  });

  it('leaves /health responses RAW (excluded from the envelope)', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.success).toBeUndefined();
    expect(res.body.data).toBeUndefined();
  });

  it('generates an OpenAPI doc with the envelope schema for auth and plain schema for health', () => {
    const builder = new DocumentBuilder()
      .setTitle('test')
      .setVersion('1')
      .build();
    const doc = cleanupOpenApiDoc(SwaggerModule.createDocument(app, builder));

    expect(doc.components?.schemas).toHaveProperty('AuthProvidersDto');
    expect(doc.components?.schemas).toHaveProperty('ApiMetaDto');
    expect(doc.components?.schemas).toHaveProperty('HealthDto');

    // The shared apiMetaSchema nests an optional pagination object — assert it
    // renders so the envelope meta isn't silently flattened/dropped.
    const metaSchema = JSON.stringify(doc.components?.schemas?.ApiMetaDto);
    expect(metaSchema).toContain('pagination');
    expect(metaSchema).toContain('totalPages');

    const authResponse = JSON.stringify(
      doc.paths['/auth/providers']?.get?.responses,
    );
    expect(authResponse).toContain('AuthProvidersDto');
    expect(authResponse).toContain('ApiMetaDto');
    expect(authResponse).toContain('success');

    const healthResponse = JSON.stringify(doc.paths['/health']?.get?.responses);
    expect(healthResponse).toContain('HealthDto');
    expect(healthResponse).not.toContain('ApiMetaDto');
  });
});
