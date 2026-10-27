import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WsAdapter } from '@nestjs/platform-ws';
import request from 'supertest';
import { App } from 'supertest/types';
import { translateResponseSchema } from '@chatofy/types';
import { AppModule } from '../src/app.module';
import { USER_REPOSITORY } from '../src/modules/users/interfaces/user-repository.interface';
import { InMemoryUserRepository } from './utils/in-memory-user.repository';
import { registerAndLogin, type Identity } from './utils/auth-fixture';
import { errorBody, successBody } from './utils/response-body';
import { requestIdMiddleware } from '../src/common/middleware/request-id.middleware';
import { PrismaService } from '../src/prisma/prisma.service';
import { AiProvidersFactory } from '../src/modules/translate/providers/ai-providers.factory';

/**
 * Boots the full AppModule with the provider factory overridden by fakes, so the
 * REST pipeline (controller → DTO validation → pipeline service → envelope) is
 * exercised end-to-end with no real ElevenLabs/Gemini calls and no API keys.
 */
describe('POST /translate (e2e)', () => {
  let app: INestApplication<App>;

  const fakeProviders = {
    stt: {
      name: 'fake-stt',
      transcribe: vi
        .fn()
        .mockResolvedValue({ text: 'xin chào', language: 'vi' }),
    },
    translation: {
      name: 'fake-translation',
      translate: vi.fn().mockResolvedValue({ text: 'hello' }),
    },
    tts: {
      name: 'fake-tts',
      // The envelope reports whatever the provider declares; omitting this
      // silently produced `audioMimeType: undefined` and made the assertions
      // below unsatisfiable.
      outputMimeType: 'audio/wav',
      synthesize: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    },
  };

  let identity: Identity;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({ $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]) })
      .overrideProvider(USER_REPOSITORY)
      .useValue(new InMemoryUserRepository())
      .overrideProvider(AiProvidersFactory)
      .useValue({ makeProviders: () => fakeProviders })
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

  const audioBase64 = Buffer.from('fake-audio-bytes').toString('base64');

  it('401s without a token, in the error envelope', async () => {
    // The headline claim of the whole auth change: the product's main endpoint
    // is no longer reachable anonymously. Asserted on the envelope, not just the
    // status, because the filter's UNAUTHORIZED mapping is what clients branch
    // on to decide between signing out and retrying.
    const res = await request(app.getHttpServer())
      .post('/translate')
      .send({ audioBase64, audioMimeType: 'audio/webm' })
      .expect(401);

    const body = errorBody(res);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('401s on a token that is not a token at all', async () => {
    await request(app.getHttpServer())
      .post('/translate')
      .set('authorization', 'Bearer not-a-jwt')
      .send({ audioBase64, audioMimeType: 'audio/webm' })
      .expect(401);
  });

  it('401s when the scheme is not Bearer', async () => {
    await request(app.getHttpServer())
      .post('/translate')
      .set('authorization', `Basic ${identity.accessToken}`)
      .send({ audioBase64, audioMimeType: 'audio/webm' })
      .expect(401);
  });

  it('returns the enveloped translation payload', async () => {
    const res = await request(app.getHttpServer())
      .post('/translate')
      .set('authorization', identity.bearer)
      .send({ audioBase64, audioMimeType: 'audio/webm' })
      .expect(201);

    const body = successBody(res, translateResponseSchema);
    expect(body.success).toBe(true);
    expect(body.data.sourceText).toBe('xin chào');
    expect(body.data.targetText).toBe('hello');
    expect(body.data.audioMimeType).toBe('audio/wav');
    expect(body.data.audioBase64).toBe(
      Buffer.from(new Uint8Array([1, 2, 3])).toString('base64'),
    );
    expect(body.meta.requestId).toBeDefined();
  });

  it('refuses the removed direction string instead of translating vi→en regardless', async () => {
    await request(app.getHttpServer())
      .post('/translate')
      .set('authorization', identity.bearer)
      .send({ audioBase64, audioMimeType: 'audio/webm', direction: 'en_to_vi' })
      .expect(400);
  });

  it('accepts an en→vi language pair + voice gender and returns a wav envelope', async () => {
    const res = await request(app.getHttpServer())
      .post('/translate')
      .set('authorization', identity.bearer)
      .send({
        audioBase64,
        audioMimeType: 'audio/webm',
        languagePair: { source: 'en', target: 'vi' },
        voiceGender: 'male',
      })
      .expect(201);

    const body = successBody(res, translateResponseSchema);
    expect(body.success).toBe(true);
    // The container comes from the provider, not from the output language.
    expect(body.data.audioMimeType).toBe('audio/wav');
    // The requested gender must reach the backend that resolves it to a voice.
    expect(fakeProviders.tts.synthesize).toHaveBeenCalledWith(
      expect.objectContaining({ language: 'vi', voiceGender: 'male' }),
    );
  });

  it('defaults the voice gender when the request omits it', async () => {
    await request(app.getHttpServer())
      .post('/translate')
      .set('authorization', identity.bearer)
      .send({ audioBase64, audioMimeType: 'audio/webm' })
      .expect(201);

    expect(fakeProviders.tts.synthesize).toHaveBeenCalledWith(
      expect.objectContaining({ voiceGender: 'female' }),
    );
  });

  it('rejects a language pair naming an unknown language with a 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/translate')
      .set('authorization', identity.bearer)
      .send({
        audioBase64,
        audioMimeType: 'audio/webm',
        languagePair: { source: 'fr', target: 'en' },
      })
      .expect(400);
    expect(errorBody(res).error.code).toBe('VALIDATION_FAILED');
  });

  it('ignores a field the contract no longer carries', async () => {
    // A client built against the old contract still sends `quality`. The schema
    // strips unknown keys rather than rejecting them, so the stale field alone
    // never costs a request. This covers the request direction only: `quality`
    // left the response schema too, so a client pinned to the old contract
    // still needs its own release before it can parse the reply.
    const res = await request(app.getHttpServer())
      .post('/translate')
      .set('authorization', identity.bearer)
      .send({ audioBase64, audioMimeType: 'audio/webm', quality: 0.5 })
      .expect(201);

    const body = successBody(res, translateResponseSchema);
    expect(body.success).toBe(true);
    expect(body.data).not.toHaveProperty('quality');
  });

  it('rejects an empty audioBase64 with a 400', async () => {
    await request(app.getHttpServer())
      .post('/translate')
      .set('authorization', identity.bearer)
      .send({ audioBase64: '', audioMimeType: 'audio/webm' })
      .expect(400);
  });
});
