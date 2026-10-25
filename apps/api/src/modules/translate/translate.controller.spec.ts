import { describe, expect, it, vi } from 'vitest';
import { ZodValidationException, ZodValidationPipe } from 'nestjs-zod';
import { TranslateRequestDto } from './dto/translate.dto';
import { TranslateController } from './translate.controller';
import { LanguageUnavailableException } from '../../common/exceptions/language-unavailable.exception';
import { DeclaredLanguageIdentifier } from './session/language-identifier';
import type { PipelineTranslatorService } from './services/pipeline-translator.service';
import type { SpeechLanguageSupport } from './providers/speech-language-support';

/**
 * The one thing worth a dedicated unit test on this controller: a language no
 * configured engine serves has to answer with a status the CALLER did not
 * cause, not a 400 that tells someone who sent a perfectly valid request to go
 * fix it.
 */

const REQUEST: TranslateRequestDto = {
  audioBase64: Buffer.from('audio').toString('base64'),
  audioMimeType: 'audio/webm',
  languagePair: { source: 'vi', target: 'en' },
  voiceGender: 'female',
  speed: 1,
};

function controllerWith(refusal: string | null): TranslateController {
  const pipeline = {
    translateTurn: vi.fn().mockResolvedValue({
      sourceText: 'xin chào',
      targetText: 'hello',
      audioBase64: '',
      audioMimeType: 'audio/mpeg',
    }),
  } as unknown as PipelineTranslatorService;
  const languageSupport = {
    refusal: vi.fn().mockReturnValue(refusal),
  } as unknown as SpeechLanguageSupport;
  return new TranslateController(
    pipeline,
    languageSupport,
    new DeclaredLanguageIdentifier(),
  );
}

describe('TranslateController', () => {
  it('answers a missing engine with a 503 LanguageUnavailableException, not a 400', async () => {
    const controller = controllerWith('This server cannot speak fr right now');

    const attempt = controller.translate(REQUEST);

    await expect(attempt).rejects.toBeInstanceOf(LanguageUnavailableException);
    await expect(attempt).rejects.toMatchObject({
      message: 'This server cannot speak fr right now',
    });
  });

  it('reports the exact 503 status the caller sees', async () => {
    const controller = controllerWith('This server cannot speak fr right now');

    try {
      await controller.translate(REQUEST);
      expect.unreachable('expected the language refusal to throw');
    } catch (err) {
      expect((err as LanguageUnavailableException).getStatus()).toBe(503);
    }
  });

  it('translates normally when the language is served', async () => {
    const controller = controllerWith(null);

    await expect(controller.translate(REQUEST)).resolves.toMatchObject({
      targetText: 'hello',
    });
  });

  // The undeclared source is a streaming-session value only. REST keeps the
  // declared pair, so the global pipe — the one `AllExceptionsFilter` maps to
  // 400 VALIDATION_FAILED — refuses it before the controller runs.
  it('refuses a detect source with a 400 validation failure, before the controller runs', () => {
    const pipe = new ZodValidationPipe();
    const body = {
      ...REQUEST,
      languagePair: { source: 'detect', target: 'en' },
    };

    let thrown: unknown;
    try {
      pipe.transform(body, { type: 'body', metatype: TranslateRequestDto });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(ZodValidationException);
    expect((thrown as ZodValidationException).getStatus()).toBe(400);
  });

  it('still takes a declared pair through the same pipe', () => {
    const pipe = new ZodValidationPipe();
    expect(
      pipe.transform(REQUEST, { type: 'body', metatype: TranslateRequestDto }),
    ).toMatchObject({ languagePair: { source: 'vi', target: 'en' } });
  });
});
