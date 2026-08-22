import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WsAdapter } from '@nestjs/platform-ws';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
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
      transcribe: jest
        .fn()
        .mockResolvedValue({ text: 'xin chào', language: 'vi' }),
    },
    translation: {
      name: 'fake-translation',
      translate: jest.fn().mockResolvedValue({ text: 'hello' }),
    },
    tts: {
      name: 'fake-tts',
      // The envelope reports whatever the provider declares; omitting this
      // silently produced `audioMimeType: undefined` and made the assertions
      // below unsatisfiable.
      outputMimeType: 'audio/wav',
      synthesize: jest.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    },
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({ $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) })
      .overrideProvider(AiProvidersFactory)
      .useValue({ makeProviders: () => fakeProviders })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useWebSocketAdapter(new WsAdapter(app));
    app.use(requestIdMiddleware);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const audioBase64 = Buffer.from('fake-audio-bytes').toString('base64');

  it('returns the enveloped translation payload', async () => {
    const res = await request(app.getHttpServer())
      .post('/translate')
      .send({ audioBase64, audioMimeType: 'audio/webm' })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.sourceText).toBe('xin chào');
    expect(res.body.data.targetText).toBe('hello');
    expect(res.body.data.audioMimeType).toBe('audio/wav');
    expect(res.body.data.audioBase64).toBe(
      Buffer.from(new Uint8Array([1, 2, 3])).toString('base64'),
    );
    expect(res.body.meta.requestId).toBeDefined();
  });

  it('accepts en→vi direction + voice gender and returns a wav envelope', async () => {
    const res = await request(app.getHttpServer())
      .post('/translate')
      .send({
        audioBase64,
        audioMimeType: 'audio/webm',
        direction: 'en_to_vi',
        voiceGender: 'male',
      })
      .expect(201);

    expect(res.body.success).toBe(true);
    // The container comes from the provider, not from the output language.
    expect(res.body.data.audioMimeType).toBe('audio/wav');
    // The requested gender must reach the backend that resolves it to a voice.
    expect(fakeProviders.tts.synthesize).toHaveBeenCalledWith(
      expect.objectContaining({ language: 'vi', voiceGender: 'male' }),
    );
  });

  it('defaults the voice gender when the request omits it', async () => {
    await request(app.getHttpServer())
      .post('/translate')
      .send({ audioBase64, audioMimeType: 'audio/webm' })
      .expect(201);

    expect(fakeProviders.tts.synthesize).toHaveBeenCalledWith(
      expect.objectContaining({ voiceGender: 'female' }),
    );
  });

  it('rejects an unknown direction with a 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/translate')
      .send({
        audioBase64,
        audioMimeType: 'audio/webm',
        direction: 'fr_to_en',
      })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('ignores a field the contract no longer carries', async () => {
    // A client built against the old contract still sends `quality`. The schema
    // strips unknown keys rather than rejecting them, so the stale field alone
    // never costs a request. This covers the request direction only: `quality`
    // left the response schema too, so a client pinned to the old contract
    // still needs its own release before it can parse the reply.
    const res = await request(app.getHttpServer())
      .post('/translate')
      .send({ audioBase64, audioMimeType: 'audio/webm', quality: 0.5 })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.quality).toBeUndefined();
  });

  it('rejects an empty audioBase64 with a 400', async () => {
    await request(app.getHttpServer())
      .post('/translate')
      .send({ audioBase64: '', audioMimeType: 'audio/webm' })
      .expect(400);
  });
});
