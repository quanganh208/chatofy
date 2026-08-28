import { PipelineTranslatorService } from './pipeline-translator.service';
import type { AiProvidersFactory } from '../providers/ai-providers.factory';

/**
 * The layer that decides whether a repair may be SHOWN.
 *
 * `translation-session-repair.spec.ts` covers the layer above with a mocked
 * pipeline, so it proves the socket behaves — and proves nothing about the guard
 * being applied, the direction being mapped, or the never-throws contract
 * holding. Those all live here, and a mock of this service is exactly what hides
 * them.
 *
 * The rule under test: **`text` is non-null only when the string is safe to put
 * on screen.** A caller that ignores `outcome` entirely must still be unable to
 * display something the guard refused.
 */

interface Harness {
  service: PipelineTranslatorService;
  repair: jest.Mock;
}

function makeService(repair?: jest.Mock, hasCapability = true): Harness {
  const repairMock = repair ?? jest.fn();
  const providers = {
    makeProviders: () => ({
      translation: {
        name: 'gemini',
        translate: jest.fn(),
        ...(hasCapability ? { repair: repairMock } : {}),
      },
    }),
  } as unknown as AiProvidersFactory;

  return {
    service: new PipelineTranslatorService(providers),
    repair: repairMock,
  };
}

/** What the recognizer emits: lowercase, unpunctuated, numbers spelled out. */
const RAW = 'ghi nhận lúc mười bảy giờ nước ngập sâu không phẩy bốn mét';
const GOOD = 'Ghi nhận lúc 17:00, nước ngập sâu 0,4 mét.';

describe('PipelineTranslatorService.repairDisplay', () => {
  it('returns the repair when it is faithful to the transcript', async () => {
    const { service } = makeService(
      jest.fn().mockResolvedValue({ text: GOOD, model: 'gemma-4-31b-it' }),
    );

    const result = await service.repairDisplay({
      text: RAW,
      direction: 'vi_to_en',
    });

    expect(result).toMatchObject({
      text: GOOD,
      outcome: 'repaired',
      model: 'gemma-4-31b-it',
    });
    // Recorded on a PASS too, not only on a rejection: a residual that starts
    // creeping upward is the earliest sign the prompt is drifting, and a column
    // that only exists on failures cannot show a trend.
    expect(result.residual).toBe(0);
  });

  it('repairs the SOURCE language of the direction', async () => {
    const { service, repair } = makeService(
      jest.fn().mockResolvedValue({ text: 'ok' }),
    );

    await service.repairDisplay({
      text: 'the meeting is at five',
      direction: 'en_to_vi',
    });

    // `en_to_vi` means the speaker is talking English, so English is what gets
    // typeset. Getting this backwards would hand an English transcript to a
    // Vietnamese instruction and score it against Vietnamese number words.
    expect(repair).toHaveBeenCalledWith({
      text: 'the meeting is at five',
      language: 'en',
    });
  });

  it('defaults to vi_to_en when no direction is given', async () => {
    const { service, repair } = makeService(
      jest.fn().mockResolvedValue({ text: 'ok' }),
    );

    await service.repairDisplay({ text: RAW });

    expect(repair).toHaveBeenCalledWith({ text: RAW, language: 'vi' });
  });

  describe('withholds anything that must not be shown', () => {
    it('refuses a paraphrase and says why', async () => {
      // `ngập` where the recognizer heard `ngọt`: a word the speaker never said,
      // rendered as though they had. This is the whole reason the guard exists.
      const { service } = makeService(
        jest.fn().mockResolvedValue({
          text: 'Nước ngọt rất mát.',
          model: 'gemma-4-31b-it',
        }),
      );

      const result = await service.repairDisplay({ text: 'nước ngập rất mát' });

      expect(result.text).toBeNull();
      // `rejected`, not `failed`. The model answered — the guard refused it. An
      // operator reading a rejection rate as an outage would go looking at the
      // network instead of the prompt.
      expect(result.outcome).toBe('rejected');
      expect(result.residual).toBeGreaterThan(0);
    });

    it('treats an empty answer as a failure rather than blanking the line', async () => {
      const { service } = makeService(
        jest.fn().mockResolvedValue({ text: '   ', model: 'm' }),
      );

      const result = await service.repairDisplay({ text: RAW });

      expect(result).toMatchObject({ text: null, outcome: 'failed' });
    });

    it('reports a provider with no repair capability without calling anything', async () => {
      const { service, repair } = makeService(jest.fn(), false);

      const result = await service.repairDisplay({ text: RAW });

      // Not a failure and must not be logged as one: it means this deployment
      // shows raw transcripts, which is a configuration, not an incident.
      expect(result).toMatchObject({ text: null, outcome: 'unsupported' });
      expect(repair).not.toHaveBeenCalled();
    });
  });

  describe('never throws, whatever the provider does', () => {
    it('absorbs a rejected request', async () => {
      // Every other provider failure in this file routes through
      // `handlePipelineError` and ends the turn. This one must not: the turn has
      // already delivered its audio and closed.
      const { service } = makeService(
        jest
          .fn()
          .mockImplementation(() => Promise.reject(new Error('429 quota'))),
      );

      await expect(service.repairDisplay({ text: RAW })).resolves.toMatchObject(
        {
          text: null,
          outcome: 'failed',
        },
      );
    });

    it('absorbs a provider that throws synchronously', async () => {
      const { service } = makeService(
        jest.fn().mockImplementation(() => {
          throw new Error('boom');
        }),
      );

      await expect(service.repairDisplay({ text: RAW })).resolves.toMatchObject(
        {
          text: null,
          outcome: 'failed',
        },
      );
    });

    it('gives up on a request that never answers, so its slot is released', async () => {
      // The caller holds one of a few process-wide slots for the whole duration
      // and nothing in the Gemini path sets a deadline. Without this, requests
      // that hang rather than fail would take every slot and disable display
      // repair for every session until the process restarted.
      jest.useFakeTimers();
      try {
        const { service } = makeService(
          jest.fn().mockReturnValue(new Promise(() => {})),
        );
        const pending = service.repairDisplay({ text: RAW });

        await jest.advanceTimersByTimeAsync(120_000);

        await expect(pending).resolves.toMatchObject({
          text: null,
          outcome: 'failed',
        });
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
