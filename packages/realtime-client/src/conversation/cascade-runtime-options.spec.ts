import { DEFAULT_MIC_PROCESSING } from '@chatofy/types';
import { describe, expect, it } from 'vitest';
import { CASCADE_RUNTIME_OPTIONS, cascadeRuntimeFor } from './cascade-runtime-options.js';

describe('cascadeRuntimeFor', () => {
  it('keeps full duplex while echo cancellation is on', () => {
    expect(cascadeRuntimeFor(DEFAULT_MIC_PROCESSING)).toBe(CASCADE_RUNTIME_OPTIONS);
  });

  it('drops to half duplex when echo cancellation is off, leaving the rest of the tuning', () => {
    const runtime = cascadeRuntimeFor({ ...DEFAULT_MIC_PROCESSING, echoCancellation: false });
    expect(runtime.fullDuplex).toBe(false);
    expect(runtime.continuous).toBe(CASCADE_RUNTIME_OPTIONS.continuous);
    expect(runtime.maxInFlight).toBe(CASCADE_RUNTIME_OPTIONS.maxInFlight);
    expect(runtime.maxUtteranceMs).toBe(CASCADE_RUNTIME_OPTIONS.maxUtteranceMs);
  });

  it('ignores noise suppression and gain control, which cannot close the loop', () => {
    expect(
      cascadeRuntimeFor({
        echoCancellation: true,
        noiseSuppression: false,
        autoGainControl: false,
      }),
    ).toBe(CASCADE_RUNTIME_OPTIONS);
  });
});
