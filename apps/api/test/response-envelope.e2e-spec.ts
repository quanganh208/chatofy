import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WsAdapter } from '@nestjs/platform-ws';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { USER_REPOSITORY } from '../src/modules/users/interfaces/user-repository.interface';
import { InMemoryUserRepository } from './utils/in-memory-user.repository';
import { registerAndLogin, type Identity } from './utils/auth-fixture';
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
  let identity: Identity;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({ $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]) })
      .overrideProvider(USER_REPOSITORY)
      .useValue(new InMemoryUserRepository())
      .compile();

    app = moduleFixture.createNestApplication();
    app.useWebSocketAdapter(new WsAdapter(app));
    app.use(requestIdMiddleware);
    await app.init();
    identity = await registerAndLogin(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('wraps a successful response in the envelope + sets x-request-id', async () => {
    const res = await request(app.getHttpServer()).get('/').expect(200);

    expect(res.body.success).toBe(true);
    // GET / is the enveloped route this suite anchors on. Asserted field by
    // field rather than with toEqual: `docs` is present only outside
    // production, so an exact match would make the suite NODE_ENV-dependent.
    expect(res.body.data).toMatchObject({
      name: expect.any(String),
      version: expect.any(String),
      description: expect.any(String),
      status: 'ok',
    });
    expect(res.body.meta.requestId).toEqual(expect.any(String));
    expect(res.body.meta.timestamp).toEqual(expect.any(String));
    expect(res.headers['x-request-id']).toBe(res.body.meta.requestId);
  });

  it('echoes a valid inbound x-request-id', async () => {
    const res = await request(app.getHttpServer())
      .get('/')
      .set('x-request-id', 'trace-abc123')
      .expect(200);
    expect(res.body.meta.requestId).toBe('trace-abc123');
    expect(res.headers['x-request-id']).toBe('trace-abc123');
  });

  it('401s a guarded route with no token, in the error envelope', async () => {
    // Asserted here rather than in the health suite, which imports only
    // HealthModule + PrismaModule and so has no guarded route to miss.
    const res = await request(app.getHttpServer()).get('/auth/me').expect(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
    expect(res.body.meta.requestId).toEqual(expect.any(String));
  });

  it('lets the same route through with a token from the real endpoints', async () => {
    const res = await request(app.getHttpServer())
      .get('/auth/me')
      .set('authorization', identity.bearer)
      .expect(200);
    expect(res.body.data.id).toBe(identity.userId);
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

  it('generates an OpenAPI doc with the envelope schema for the descriptor and plain schema for health', () => {
    const builder = new DocumentBuilder()
      .setTitle('test')
      .setVersion('1')
      .build();
    const doc = cleanupOpenApiDoc(SwaggerModule.createDocument(app, builder));

    expect(doc.components?.schemas).toHaveProperty('ServiceDescriptorDto');
    expect(doc.components?.schemas).toHaveProperty('ApiMetaDto');
    expect(doc.components?.schemas).toHaveProperty('HealthDto');

    // The shared apiMetaSchema nests an optional pagination object — assert it
    // renders so the envelope meta isn't silently flattened/dropped.
    const metaSchema = JSON.stringify(doc.components?.schemas?.ApiMetaDto);
    expect(metaSchema).toContain('pagination');
    expect(metaSchema).toContain('totalPages');

    const rootResponse = JSON.stringify(doc.paths['/']?.get?.responses);
    expect(rootResponse).toContain('ServiceDescriptorDto');
    expect(rootResponse).toContain('ApiMetaDto');
    expect(rootResponse).toContain('success');

    const healthResponse = JSON.stringify(doc.paths['/health']?.get?.responses);
    expect(healthResponse).toContain('HealthDto');
    expect(healthResponse).not.toContain('ApiMetaDto');
  });
});
