import { describe, expect, it, vi } from 'vitest';
import type { TranslateRequestDto } from './dto/translate.dto';
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
  direction: 'vi_to_en',
  voiceGender: 'female',
  speed: 1,
} as TranslateRequestDto;

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
});
