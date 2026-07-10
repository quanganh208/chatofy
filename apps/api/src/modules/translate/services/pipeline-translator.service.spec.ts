import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ProviderConnectionError } from '@chatofy/ai-providers';
import { PipelineTranslatorService } from './pipeline-translator.service';
import type {
  AiProvidersFactory,
  PipelineProviders,
} from '../providers/ai-providers.factory';

/** Build a fake provider trio with overridable behavior per test. */
function fakeTrio(
  overrides: Partial<PipelineProviders> = {},
): PipelineProviders {
  return {
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
      synthesize: jest.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    },
    ...overrides,
  };
}

function serviceWith(trio: PipelineProviders): PipelineTranslatorService {
  const factory = {
    makeProviders: jest.fn().mockReturnValue(trio),
  } as unknown as AiProvidersFactory;
  return new PipelineTranslatorService(factory);
}

describe('PipelineTranslatorService', () => {
  const input = {
    audio: new Uint8Array([9, 9]),
    mimeType: 'audio/webm',
    quality: 0.5,
  };

  it('runs STT → translate → TTS and returns the enveloped payload shape', async () => {
    // Standalone mocks (not object methods) so call assertions don't trip the
    // unbound-method lint rule.
    const transcribe = jest
      .fn()
      .mockResolvedValue({ text: 'xin chào', language: 'vi' });
    const translate = jest.fn().mockResolvedValue({ text: 'hello' });
    const synthesize = jest.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));
    const trio = {
      stt: { name: 'fake-stt', transcribe },
      translation: { name: 'fake-translation', translate },
      tts: { name: 'fake-tts', synthesize },
    } as PipelineProviders;

    const result = await serviceWith(trio).translateTurn(input);

    expect(transcribe).toHaveBeenCalledWith(input.audio, 'audio/webm', 'vi');
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
      quality: 0.5,
    });
  });

  it('runs en→vi: English STT, en→vi translate, VieNeu wav output', async () => {
    const transcribe = jest
      .fn()
      .mockResolvedValue({ text: 'hello', language: 'en' });
    const translate = jest.fn().mockResolvedValue({ text: 'xin chào' });
    const synthesize = jest.fn().mockResolvedValue(new Uint8Array([7, 8]));
    const trio = {
      stt: { name: 'fake-stt', transcribe },
      translation: { name: 'fake-translation', translate },
      tts: { name: 'fake-vieneu', synthesize },
    } as PipelineProviders;
    const makeProviders = jest.fn().mockReturnValue(trio);
    const factory = { makeProviders } as unknown as AiProvidersFactory;
    const service = new PipelineTranslatorService(factory);

    const result = await service.translateTurn({
      ...input,
      direction: 'en_to_vi',
      voice: 'Thái Sơn',
    });

    // Factory asked for a Vietnamese-output trio (→ VieNeu).
    expect(makeProviders).toHaveBeenCalledWith(expect.anything(), 'vi');
    expect(transcribe).toHaveBeenCalledWith(input.audio, 'audio/webm', 'en');
    expect(translate).toHaveBeenCalledWith({
      text: 'hello',
      sourceLanguage: 'en',
      targetLanguage: 'vi',
    });
    expect(synthesize).toHaveBeenCalledWith(
      expect.objectContaining({ language: 'vi', voice: 'Thái Sơn' }),
    );
    expect(result.audioMimeType).toBe('audio/wav');
    expect(result.targetText).toBe('xin chào');
  });

  it('defaults to vi→en and routes English output (audio/mpeg)', async () => {
    const makeProviders = jest.fn().mockReturnValue(fakeTrio());
    const factory = { makeProviders } as unknown as AiProvidersFactory;
    const result = await new PipelineTranslatorService(factory).translateTurn(
      input,
    );
    expect(makeProviders).toHaveBeenCalledWith(expect.anything(), 'en');
    expect(result.audioMimeType).toBe('audio/mpeg');
  });

  it('clamps an out-of-range quality value', async () => {
    const result = await serviceWith(fakeTrio()).translateTurn({
      ...input,
      quality: 5,
    });
    expect(result.quality).toBe(1);
  });

  it('rejects with BadRequest when no speech is detected', async () => {
    const trio = fakeTrio({
      stt: {
        name: 'fake-stt',
        transcribe: jest
          .fn()
          .mockResolvedValue({ text: '   ', language: 'vi' }),
      },
    });
    await expect(serviceWith(trio).translateTurn(input)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('maps provider connection failures to ServiceUnavailable', async () => {
    const trio = fakeTrio({
      translation: {
        name: 'fake-translation',
        translate: jest
          .fn()
          .mockRejectedValue(new ProviderConnectionError('upstream down')),
      },
    });
    await expect(serviceWith(trio).translateTurn(input)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
