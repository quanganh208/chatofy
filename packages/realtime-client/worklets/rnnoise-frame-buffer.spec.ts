import { describe, expect, it, vi } from 'vitest';
import { RNNOISE_FRAME_SIZE, RnnoiseFrameBuffer } from './rnnoise-frame-buffer.js';

/**
 * The reframing between the browser's 128-sample quanta and RNNoise's 480-sample
 * frames, tested for the two things it promises: equal sample counts (so it is a
 * transform, not a gate) and a faithful signal under an identity denoiser (so it
 * cleans, never scrambles). The RNNoise model itself is not here — it runs only
 * in a browser worklet — but this is the logic around it, and it is pure.
 */
const identity = (frame: Float32Array): Float32Array => frame.slice(0);

/** A rising ramp, so a delayed copy is recognisable sample by sample. */
function ramp(length: number): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = (i + 1) / length;
  return out;
}

describe('RnnoiseFrameBuffer', () => {
  it('returns exactly as many samples as it is given, every call', () => {
    const buffer = new RnnoiseFrameBuffer(identity);
    for (const size of [128, 128, 128, 128, 256, 480, 1024]) {
      expect(buffer.process(new Float32Array(size)).length).toBe(size);
    }
  });

  it('preserves the total sample count across a stream', () => {
    const buffer = new RnnoiseFrameBuffer(identity);
    let produced = 0;
    let consumed = 0;
    for (let i = 0; i < 50; i++) {
      consumed += 128;
      produced += buffer.process(new Float32Array(128)).length;
    }
    expect(produced).toBe(consumed);
  });

  it('feeds the denoiser whole 480-sample frames and nothing else', () => {
    const denoise = vi.fn(identity);
    const buffer = new RnnoiseFrameBuffer(denoise);
    // 10 quanta of 128 = 1280 samples = two 480-frames, with 320 left pending.
    for (let i = 0; i < 10; i++) buffer.process(new Float32Array(128));
    expect(denoise).toHaveBeenCalledTimes(2);
    for (const call of denoise.mock.calls) {
      expect(call[0].length).toBe(RNNOISE_FRAME_SIZE);
    }
  });

  it('reproduces the input under an identity denoiser, delayed not distorted', () => {
    const buffer = new RnnoiseFrameBuffer(identity);
    const input = ramp(9600); // long enough to run well past warm-up
    const output: number[] = [];

    // Push in 128-quanta, exactly as the worklet would.
    for (let offset = 0; offset + 128 <= input.length; offset += 128) {
      output.push(...buffer.process(input.subarray(offset, offset + 128)));
    }

    // Leading zeros are the warm-up latency; after them the ramp comes through
    // unchanged, and — the property that a naive pipe fails — with NO zero in the
    // middle, because a hole in a denoised stream is an audible click.
    const delay = output.findIndex((s) => s !== 0);
    expect(delay).toBeGreaterThan(0);
    const body = output.slice(delay);
    expect(body.every((s) => s !== 0)).toBe(true);
    for (let i = 0; i < body.length; i++) {
      expect(body[i]).toBeCloseTo(input[i]!, 6);
    }
  });

  it('rejects a denoiser that changes the frame length', () => {
    const buffer = new RnnoiseFrameBuffer((frame) => frame.subarray(0, 100));
    expect(() => {
      for (let i = 0; i < 4; i++) buffer.process(new Float32Array(128));
    }).toThrow(/expected 480/);
  });

  it('will not construct without a denoiser', () => {
    // @ts-expect-error deliberately wrong to prove the guard fires
    expect(() => new RnnoiseFrameBuffer(null)).toThrow(TypeError);
  });
});
