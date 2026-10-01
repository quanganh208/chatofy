import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BadRequestException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  LocalSpeechTtsProvider,
  ProviderBusyError,
  ProviderConnectionError,
  ProviderResponseError,
} from '@chatofy/ai-providers';
import {
  NoSpeechDetectedException,
  PipelineTranslatorService,
  RESTORE_BUDGET_MS,
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

function serviceWith(
  trio: PipelineProviders,
  restore?: (text: string, options: unknown) => Promise<string>,
  { localStt = true }: { localStt?: boolean } = {},
): PipelineTranslatorService {
  const factory = {
    makeProviders: vi.fn().mockReturnValue(trio),
    sttWritesBareText: vi.fn().mockReturnValue(localStt),
    makeDisplayRestorer: vi.fn().mockReturnValue({
      name: 'fake-restorer',
      restore: restore ?? vi.fn().mockRejectedValue(new Error('no restorer')),
    }),
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

  it('forwards minSpeechMs to the recognizer, beside hotwords', async () => {
    const transcribe = vi
      .fn()
      .mockResolvedValue({ text: 'xin chào', language: 'vi' });
    const trio = fakeTrio({ stt: { name: 'fake-stt', transcribe } });

    await serviceWith(trio).transcribeAndTranslate(
      { ...input, minSpeechMs: 300 },
      VI_TO_EN,
    );

    expect(transcribe).toHaveBeenCalledWith(input.audio, 'audio/webm', 'vi', {
      hotwords: undefined,
      minSpeechMs: 300,
    });
  });

  it('sends minSpeechMs undefined when the caller named none', async () => {
    const transcribe = vi
      .fn()
      .mockResolvedValue({ text: 'xin chào', language: 'vi' });
    const trio = fakeTrio({ stt: { name: 'fake-stt', transcribe } });

    await serviceWith(trio).transcribeAndTranslate(input, VI_TO_EN);

    expect(transcribe).toHaveBeenCalledWith(input.audio, 'audio/webm', 'vi', {
      hotwords: undefined,
      minSpeechMs: undefined,
    });
  });

  describe('a recognizer that heard nothing', () => {
    it('throws the gated exception when the sidecar verdict says speech was below the floor', async () => {
      const trio = fakeTrio({
        stt: {
          name: 'fake-stt',
          transcribe: vi
            .fn()
            .mockResolvedValue({ text: '', language: 'vi', speechMs: 120 }),
        },
      });

      await expect(
        serviceWith(trio).transcribeAndTranslate(
          { ...input, minSpeechMs: 300 },
          VI_TO_EN,
        ),
      ).rejects.toBeInstanceOf(NoSpeechDetectedException);
    });

    it('throws the plain exception when no floor was asked for', async () => {
      const trio = fakeTrio({
        stt: {
          name: 'fake-stt',
          transcribe: vi.fn().mockResolvedValue({ text: '', language: 'vi' }),
        },
      });

      const err = await serviceWith(trio)
        .transcribeAndTranslate(input, VI_TO_EN)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err).not.toBeInstanceOf(NoSpeechDetectedException);
    });

    it('throws the plain exception when the floor was explicitly zero', async () => {
      const trio = fakeTrio({
        stt: {
          name: 'fake-stt',
          transcribe: vi
            .fn()
            .mockResolvedValue({ text: '', language: 'vi', speechMs: 120 }),
        },
      });

      const err = await serviceWith(trio)
        .transcribeAndTranslate({ ...input, minSpeechMs: 0 }, VI_TO_EN)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err).not.toBeInstanceOf(NoSpeechDetectedException);
    });

    // H1: a floor was asked for and the decoder came back empty, but the
    // sidecar's OWN measurement says it heard enough speech to clear the
    // floor. The decoder simply lost the utterance — the exact case the "No
    // speech detected" warning exists to catch — so this must keep the banner,
    // not swallow it as if the gate had refused the turn.
    it('throws the plain exception when the sidecar verdict says speech was at or above the floor', async () => {
      const trio = fakeTrio({
        stt: {
          name: 'fake-stt',
          transcribe: vi
            .fn()
            .mockResolvedValue({ text: '', language: 'vi', speechMs: 300 }),
        },
      });

      const err = await serviceWith(trio)
        .transcribeAndTranslate({ ...input, minSpeechMs: 300 }, VI_TO_EN)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err).not.toBeInstanceOf(NoSpeechDetectedException);
    });

    // H1: a floor was asked for, but the backend never answered `speechMs` at
    // all — ElevenLabs, which cannot gate on speech, or a local sidecar that
    // predates the field. The floor was silently ignored, so this empty decode
    // is not the gate's doing and must keep the banner.
    it('throws the plain exception when the backend reported no speechMs at all', async () => {
      const trio = fakeTrio({
        stt: {
          name: 'fake-stt',
          transcribe: vi.fn().mockResolvedValue({ text: '', language: 'vi' }),
        },
      });

      const err = await serviceWith(trio)
        .transcribeAndTranslate({ ...input, minSpeechMs: 300 }, VI_TO_EN)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err).not.toBeInstanceOf(NoSpeechDetectedException);
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

  describe('transcribeAndTranslate — display restore', () => {
    afterEach(() => vi.useRealTimers());

    it('restores the transcript beside the translation when asked', async () => {
      const restore = vi.fn().mockResolvedValue('Xin chào.');
      const result = await serviceWith(
        fakeTrio(),
        restore,
      ).transcribeAndTranslate(
        { ...input, restoreDisplay: { context: 'trước đó', terms: ['VNeID'] } },
        VI_TO_EN,
      );

      expect(result).toEqual({
        sourceText: 'xin chào',
        translations: { en: 'hello' },
        restored: 'Xin chào.',
      });
      expect(restore).toHaveBeenCalledWith('xin chào', {
        language: 'vi',
        context: 'trước đó',
        terms: ['VNeID'],
      });
    });

    it('starts the restore before the translation finishes, not after', async () => {
      // The whole latency argument: the restore's cost must sit beside the
      // translation. Asserted by order, not the clock.
      const order: string[] = [];
      let finishTranslation!: (value: { text: string }) => void;
      const trio = fakeTrio({
        translation: {
          name: 'fake-translation',
          translate: vi.fn(
            () =>
              new Promise<{ text: string }>((resolve) => {
                order.push('translate started');
                finishTranslation = resolve;
              }),
          ),
        },
      });
      const restore = vi.fn(async () => {
        order.push('restore started');
        return 'Xin chào.';
      });
      const pending = serviceWith(trio, restore).transcribeAndTranslate(
        { ...input, restoreDisplay: {} },
        VI_TO_EN,
      );
      await vi.waitFor(() => expect(order).toHaveLength(2));
      finishTranslation({ text: 'hello' });

      await expect(pending).resolves.toMatchObject({ restored: 'Xin chào.' });
      expect(order).toContain('restore started');
    });

    it('keeps the turn when the restorer fails, with no restored text', async () => {
      vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const restore = vi.fn().mockRejectedValue(new Error('503 not loaded'));

      const result = await serviceWith(
        fakeTrio(),
        restore,
      ).transcribeAndTranslate({ ...input, restoreDisplay: {} }, VI_TO_EN);

      expect(result).toEqual({
        sourceText: 'xin chào',
        translations: { en: 'hello' },
      });
    });

    it('gives up on a restorer that runs past its budget, counted from its start', async () => {
      vi.useFakeTimers();
      const restore = vi.fn(() => new Promise<string>(() => undefined));
      let settled = false;
      const pending = serviceWith(fakeTrio(), restore)
        .transcribeAndTranslate({ ...input, restoreDisplay: {} }, VI_TO_EN)
        .finally(() => (settled = true));

      await vi.advanceTimersByTimeAsync(RESTORE_BUDGET_MS - 1);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);

      await expect(pending).resolves.toEqual({
        sourceText: 'xin chào',
        translations: { en: 'hello' },
      });
    });

    it('stops asking a restorer that reported itself absent, and logs it once', async () => {
      const warn = vi
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      const restore = vi
        .fn()
        .mockRejectedValue(new ProviderResponseError('not loaded', 503));
      const service = serviceWith(fakeTrio(), restore);

      await service.transcribeAndTranslate(
        { ...input, restoreDisplay: {} },
        VI_TO_EN,
      );
      await service.transcribeAndTranslate(
        { ...input, restoreDisplay: {} },
        VI_TO_EN,
      );

      expect(restore).toHaveBeenCalledTimes(1);
      expect(
        warn.mock.calls.filter(([m]) => String(m).includes('restore')),
      ).toHaveLength(1);
    });

    it('keeps asking a restorer that was only busy', async () => {
      const restore = vi
        .fn()
        .mockRejectedValue(new ProviderResponseError('busy', 429));
      const service = serviceWith(fakeTrio(), restore);

      await service.transcribeAndTranslate(
        { ...input, restoreDisplay: {} },
        VI_TO_EN,
      );
      await service.transcribeAndTranslate(
        { ...input, restoreDisplay: {} },
        VI_TO_EN,
      );

      expect(restore).toHaveBeenCalledTimes(2);
    });

    it('leaves a cloud recognizer’s own punctuation alone', async () => {
      // Only the local recognizer writes bare text; restoring a cased,
      // punctuated transcript would replace it with a weaker reading.
      const restore = vi.fn().mockResolvedValue('xin chào.');

      const result = await serviceWith(fakeTrio(), restore, {
        localStt: false,
      }).transcribeAndTranslate({ ...input, restoreDisplay: {} }, VI_TO_EN);

      expect(restore).not.toHaveBeenCalled();
      expect(result).not.toHaveProperty('restored');
    });

    it('stops asking a restorer nobody is listening for, and logs it once', async () => {
      const warn = vi
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      const refused = Object.assign(new Error('connect ECONNREFUSED'), {
        name: 'TypeError',
      });
      const restore = vi
        .fn()
        .mockRejectedValue(
          new ProviderConnectionError('local restore failed', refused),
        );
      const service = serviceWith(fakeTrio(), restore);

      await service.transcribeAndTranslate(
        { ...input, restoreDisplay: {} },
        VI_TO_EN,
      );
      await service.transcribeAndTranslate(
        { ...input, restoreDisplay: {} },
        VI_TO_EN,
      );

      expect(restore).toHaveBeenCalledTimes(1);
      expect(
        warn.mock.calls.filter(([m]) => String(m).includes('restore')),
      ).toHaveLength(1);
    });

    it('keeps asking a restorer that only timed out', async () => {
      vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const timedOut = Object.assign(new Error('aborted'), {
        name: 'TimeoutError',
      });
      const restore = vi
        .fn()
        .mockRejectedValue(
          new ProviderConnectionError('local restore timed out', timedOut),
        );
      const service = serviceWith(fakeTrio(), restore);

      await service.transcribeAndTranslate(
        { ...input, restoreDisplay: {} },
        VI_TO_EN,
      );
      await service.transcribeAndTranslate(
        { ...input, restoreDisplay: {} },
        VI_TO_EN,
      );

      expect(restore).toHaveBeenCalledTimes(2);
    });

    it('never calls the restorer for a turn that did not ask', async () => {
      const restore = vi.fn().mockResolvedValue('Xin chào.');

      await serviceWith(fakeTrio(), restore).transcribeAndTranslate(
        input,
        VI_TO_EN,
      );

      expect(restore).not.toHaveBeenCalled();
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

    describe('a sidecar /voices that predates speedAdjustable', () => {
      const realFetch = global.fetch;
      afterEach(() => {
        global.fetch = realFetch;
      });

      it('answers with speedAdjustable absent, not false, cold or warm', async () => {
        // The real local provider over a mocked sidecar: the flag must survive
        // provider → cache → response as ABSENT, which the web reads as
        // "unknown" and keeps the rate control visible for.
        const fetchMock = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            voices: [{ token: '9', label: 'Sarah', gender: 'female' }],
          }),
        });
        global.fetch = fetchMock;
        const service = serviceWith(
          fakeTrio({
            tts: new LocalSpeechTtsProvider({
              baseUrl: 'http://localhost:8003',
            }),
          }),
        );

        for (const answer of [
          await service.listVoices('en'),
          await service.listVoices('en'),
        ]) {
          expect(answer).not.toHaveProperty('speedAdjustable');
          expect(JSON.parse(JSON.stringify(answer))).toStrictEqual({
            voices: [{ token: '9', label: 'Sarah', gender: 'female' }],
          });
        }
        expect(fetchMock).toHaveBeenCalledTimes(1);
      });
    });

    it('answers an explicit false for a backend with no catalog, which ignores speed', async () => {
      const service = serviceWith(fakeTrio());

      await expect(service.listVoices('en')).resolves.toStrictEqual({
        voices: [],
        speedAdjustable: false,
      });
    });
  });
});
