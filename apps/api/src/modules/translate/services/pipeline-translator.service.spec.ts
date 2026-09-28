import { describe, expect, it, vi } from 'vitest';
import {
  BadRequestException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ProviderBusyError,
  ProviderConnectionError,
  ProviderResponseError,
} from '@chatofy/ai-providers';
import {
  PipelineTranslatorService,
  SpeechEngineBusyException,
} from './pipeline-translator.service';
import type {
  AiProvidersFactory,
  PipelineProviders,
} from '../providers/ai-providers.factory';
import { planTurnLanguages } from '../session/turn-language-plan';

/** The plan every default-direction test in this file drives the pipeline with. */
const VI_TO_EN = planTurnLanguages(['vi', 'en'], ['vi']);
const EN_TO_VI = planTurnLanguages(['en', 'vi'], ['en']);

/** Build a fake provider trio with overridable behavior per test. */
function fakeTrio(
  overrides: Partial<PipelineProviders> = {},
): PipelineProviders {
  return {
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
      outputMimeType: 'audio/mpeg',
      synthesize: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    },
    ...overrides,
  };
}

function serviceWith(trio: PipelineProviders): PipelineTranslatorService {
  const factory = {
    makeProviders: vi.fn().mockReturnValue(trio),
  } as unknown as AiProvidersFactory;
  return new PipelineTranslatorService(factory);
}

describe('PipelineTranslatorService', () => {
  const input = {
    audio: new Uint8Array([9, 9]),
    mimeType: 'audio/webm',
  };

  /**
   * A turn whose audio yields no words leaves nothing behind but this line.
   *
   * Two production recordings each lost an utterance, and which path dropped
   * them could not be established afterwards because nothing wrote anything
   * down. This branch was the leading suspect until the same audio was decoded
   * twelve ways through the live recogniser and came back non-empty every time,
   * so how often it actually fires is still an open question — and this line is
   * what will answer it.
   */
  it('says in the log when the recognizer heard nothing', async () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const trio = fakeTrio({
      stt: {
        name: 'fake-stt',
        transcribe: vi.fn().mockResolvedValue({ text: '   ', language: 'vi' }),
      },
    });

    await expect(
      serviceWith(trio).transcribeAndTranslate(input, VI_TO_EN),
    ).rejects.toBeInstanceOf(BadRequestException);

    const line = warn.mock.calls.map(([message]) => String(message)).join('\n');
    expect(line).toContain('No speech detected');
    // The language and the byte count, because "no speech" on two bytes and on
    // two seconds of audio are different failures with different remedies.
    expect(line).toContain('vi');
    expect(line).toContain(`${input.audio.byteLength}B`);
    warn.mockRestore();
  });

  it('spends the session hotwords on the recognizer as well as the translator', async () => {
    const transcribe = vi
      .fn()
      .mockResolvedValue({ text: 'giải poker', language: 'vi' });
    const translate = vi.fn().mockResolvedValue({ text: 'a poker tournament' });
    const trio = {
      stt: { name: 'fake-stt', transcribe },
      translation: { name: 'fake-translation', translate },
      tts: {
        name: 'fake-tts',
        outputMimeType: 'audio/mpeg',
        synthesize: vi.fn(),
      },
    } as unknown as PipelineProviders;
    const hints = { hotwords: ['poker', 'Target'] };

    await serviceWith(trio).transcribeAndTranslate(
      { ...input, hints },
      VI_TO_EN,
    );

    // The recognizer is where a hotword was always meant to be spent: the field
    // exists because the recognizer mishears these words.
    expect(transcribe).toHaveBeenCalledWith(input.audio, 'audio/webm', 'vi', {
      hotwords: ['poker', 'Target'],
    });
    // And the translator still receives them, for the term biasing misses.
    expect(translate).toHaveBeenCalledWith(expect.objectContaining({ hints }));
  });

  it('carries preceding finished utterances to the translator, not the recognizer', async () => {
    // The recognizer decodes audio and has no use for what was said before it;
    // the translator is the one that cannot tell what sentence a two-word turn
    // belongs to. Passing the history to both would spend a second untrusted
    // channel for nothing.
    const transcribe = vi
      .fn()
      .mockResolvedValue({ text: 'Thì nó', language: 'vi' });
    const translate = vi.fn().mockResolvedValue({ text: 'And it' });
    const trio = {
      stt: { name: 'fake-stt', transcribe },
      translation: { name: 'fake-translation', translate },
      tts: {
        name: 'fake-tts',
        outputMimeType: 'audio/mpeg',
        synthesize: vi.fn(),
      },
    } as unknown as PipelineProviders;
    const context = ['Nhưng mà cái mục tiêu mà tôi muốn làm thì'];

    await serviceWith(trio).transcribeAndTranslate(
      { ...input, context },
      VI_TO_EN,
    );

    expect(translate).toHaveBeenCalledWith(
      expect.objectContaining({ context }),
    );
    expect(transcribe).toHaveBeenCalledWith(input.audio, 'audio/webm', 'vi', {
      hotwords: undefined,
    });
  });

  it('carries context on the text-only translate path too', async () => {
    // The live preview and any caller working from a running transcript reach
    // the translator here rather than through the audio path.
    const translate = vi.fn().mockResolvedValue({ text: 'And it' });
    const trio = fakeTrio({
      translation: { name: 'fake-translation', translate },
    });
    const context = ['Nhưng mà cái mục tiêu mà tôi muốn làm thì'];

    await serviceWith(trio).translate({
      text: 'Thì nó',
      source: 'vi',
      target: 'en',
      context,
    });

    expect(translate).toHaveBeenCalledWith(
      expect.objectContaining({ context }),
    );
  });

  it('runs STT → translate → TTS and returns the enveloped payload shape', async () => {
    // Standalone mocks (not object methods) so call assertions don't trip the
    // unbound-method lint rule.
    const transcribe = vi
      .fn()
      .mockResolvedValue({ text: 'xin chào', language: 'vi' });
    const translate = vi.fn().mockResolvedValue({ text: 'hello' });
    const synthesize = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));
    const trio = {
      stt: { name: 'fake-stt', transcribe },
      translation: { name: 'fake-translation', translate },
      tts: { name: 'fake-tts', outputMimeType: 'audio/mpeg', synthesize },
    } as PipelineProviders;

    const result = await serviceWith(trio).translateTurn(input, VI_TO_EN);

    expect(transcribe).toHaveBeenCalledWith(input.audio, 'audio/webm', 'vi', {
      hotwords: undefined,
    });
    expect(translate).toHaveBeenCalledWith({
      text: 'xin chào',
      sourceLanguage: 'vi',
      targetLanguage: 'en',
    });
    expect(result).toEqual({
      sourceText: 'xin chào',
      targetText: 'hello',
      audioBase64: Buffer.from(new Uint8Array([1, 2, 3])).toString('base64'),
      audioMimeType: 'audio/mpeg',
    });
  });

  it('runs en→vi: English STT, en→vi translate, wav output', async () => {
    const transcribe = vi
      .fn()
      .mockResolvedValue({ text: 'hello', language: 'en' });
    const translate = vi.fn().mockResolvedValue({ text: 'xin chào' });
    const synthesize = vi.fn().mockResolvedValue(new Uint8Array([7, 8]));
    const trio = {
      stt: { name: 'fake-stt', transcribe },
      translation: { name: 'fake-translation', translate },
      tts: { name: 'fake-local', outputMimeType: 'audio/wav', synthesize },
    } as PipelineProviders;
    const makeProviders = vi.fn().mockReturnValue(trio);
    const factory = { makeProviders } as unknown as AiProvidersFactory;
    const service = new PipelineTranslatorService(factory);

    const result = await service.translateTurn(
      { ...input, voiceGender: 'male' },
      EN_TO_VI,
    );

    // The trio no longer depends on direction — the language travels with each
    // provider call instead.
    expect(makeProviders).toHaveBeenCalledWith();
    expect(transcribe).toHaveBeenCalledWith(input.audio, 'audio/webm', 'en', {
      hotwords: undefined,
    });
    expect(translate).toHaveBeenCalledWith({
      text: 'hello',
      sourceLanguage: 'en',
      targetLanguage: 'vi',
    });
    expect(synthesize).toHaveBeenCalledWith(
      expect.objectContaining({ language: 'vi', voiceGender: 'male' }),
    );
    expect(result.audioMimeType).toBe('audio/wav');
    expect(result.targetText).toBe('xin chào');
  });

  it('defaults to vi→en and reports the provider’s own output format', async () => {
    const transcribe = vi
      .fn()
      .mockResolvedValue({ text: 'xin chào', language: 'vi' });
    const makeProviders = vi
      .fn()
      .mockReturnValue(fakeTrio({ stt: { name: 'fake-stt', transcribe } }));
    const factory = { makeProviders } as unknown as AiProvidersFactory;
    const result = await new PipelineTranslatorService(factory).translateTurn(
      input,
      VI_TO_EN,
    );
    expect(makeProviders).toHaveBeenCalledWith();
    // Direction reaches the provider as an argument, not via the trio it built.
    expect(transcribe).toHaveBeenCalledWith(input.audio, 'audio/webm', 'vi', {
      hotwords: undefined,
    });
    expect(result.audioMimeType).toBe('audio/mpeg');
  });

  it('rejects with BadRequest when no speech is detected', async () => {
    const trio = fakeTrio({
      stt: {
        name: 'fake-stt',
        transcribe: vi.fn().mockResolvedValue({ text: '   ', language: 'vi' }),
      },
    });
    await expect(
      serviceWith(trio).translateTurn(input, VI_TO_EN),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('maps provider connection failures to ServiceUnavailable', async () => {
    const trio = fakeTrio({
      translation: {
        name: 'fake-translation',
        translate: vi
          .fn()
          .mockRejectedValue(new ProviderConnectionError('upstream down')),
      },
    });
    await expect(
      serviceWith(trio).translateTurn(input, VI_TO_EN),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('maps provider response failures to ServiceUnavailable', async () => {
    const trio = fakeTrio({
      translation: {
        name: 'fake-translation',
        translate: vi
          .fn()
          .mockRejectedValue(new ProviderResponseError('bad key', 401)),
      },
    });
    await expect(
      serviceWith(trio).translateTurn(input, VI_TO_EN),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('maps a busy speech engine to its own 503, on every synthesis path', async () => {
    const busy = new ProviderBusyError('vi engine busy for more than 15s');
    const trio = fakeTrio({
      tts: {
        name: 'fake-local',
        outputMimeType: 'audio/wav',
        synthesize: vi.fn().mockRejectedValue(busy),
        synthesizeStream: vi.fn().mockRejectedValue(busy),
      },
    });
    const service = serviceWith(trio);
    const req = { text: 'xin chào', language: 'vi' as const };

    await expect(service.synthesize(req)).rejects.toBeInstanceOf(
      SpeechEngineBusyException,
    );
    await expect(
      service.synthesizeStream(req, new AbortController().signal),
    ).rejects.toBeInstanceOf(SpeechEngineBusyException);
    // REST keeps the 503 and the message it has always had.
    const rest = service.translateTurn(input, VI_TO_EN);
    await expect(rest).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(rest).rejects.toThrow('Translation provider request failed');
  });

  it('takes the response MIME type from the TTS provider, not a language map', async () => {
    const trio = fakeTrio({
      tts: {
        name: 'fake-custom',
        outputMimeType: 'audio/x-test',
        synthesize: vi.fn().mockResolvedValue(new Uint8Array([1])),
      },
    });
    const result = await serviceWith(trio).translateTurn(input, VI_TO_EN);
    expect(result.audioMimeType).toBe('audio/x-test');
  });

  describe('translateAll', () => {
    it('fans out one provider request per target, in parallel', async () => {
      const translate = vi
        .fn()
        .mockImplementation(({ targetLanguage }: { targetLanguage: string }) =>
          Promise.resolve({ text: `<${targetLanguage}>` }),
        );
      const trio = fakeTrio({
        translation: { name: 'fake-translation', translate },
      });

      const translations = await serviceWith(trio).translateAll({
        text: 'xin chào',
        source: 'vi',
        targets: ['vi', 'en'],
      });

      expect(translate).toHaveBeenCalledTimes(2);
      expect(translations).toEqual({ vi: '<vi>', en: '<en>' });
    });

    it('costs exactly one request for one target — the shape every call before fan-out took', async () => {
      const translate = vi.fn().mockResolvedValue({ text: 'hello' });
      const trio = fakeTrio({
        translation: { name: 'fake-translation', translate },
      });

      const translations = await serviceWith(trio).translateAll({
        text: 'xin chào',
        source: 'vi',
        targets: ['en'],
      });

      expect(translate).toHaveBeenCalledTimes(1);
      expect(translations).toEqual({ en: 'hello' });
    });
  });

  describe('transcribeAndTranslate — fan-out', () => {
    it('translates into every target the plan names, keyed by language', async () => {
      const translate = vi
        .fn()
        .mockImplementation(({ targetLanguage }: { targetLanguage: string }) =>
          Promise.resolve({ text: `<${targetLanguage}>` }),
        );
      const trio = fakeTrio({
        translation: { name: 'fake-translation', translate },
      });
      // A mixed turn: both conversation languages are sources, so both are
      // targets too — see `translationTargets` in `@chatofy/types`.
      const mixed = planTurnLanguages(['vi', 'en'], ['vi', 'en']);

      const { translations } = await serviceWith(trio).transcribeAndTranslate(
        input,
        mixed,
      );

      expect(translate).toHaveBeenCalledTimes(2);
      expect(translations).toEqual({ vi: '<vi>', en: '<en>' });
    });
  });

  describe('listVoices', () => {
    it('never leaks the cache entry expiresAt, cold or warm', async () => {
      const catalog = {
        voices: [{ token: 'a', label: 'A', gender: 'female' as const }],
        speedAdjustable: true,
      };
      const listVoices = vi.fn().mockResolvedValue(catalog);
      const trio = fakeTrio({
        tts: {
          name: 'fake-tts',
          outputMimeType: 'audio/mpeg',
          synthesize: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
          listVoices,
        },
      });
      const service = serviceWith(trio);

      // Cold: built straight from the provider's own answer.
      const cold = await service.listVoices('en');
      expect(cold).toEqual(catalog);
      expect(cold).not.toHaveProperty('expiresAt');

      // Warm: the SAME entry this service just cached, and the whole point of
      // this test — a naive `return cached` answers with `expiresAt` still on
      // it, so the response shape would depend on which call this was.
      const warm = await service.listVoices('en');
      expect(listVoices).toHaveBeenCalledTimes(1);
      expect(warm).toEqual(catalog);
      expect(warm).not.toHaveProperty('expiresAt');
    });
  });
});
