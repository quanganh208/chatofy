import { describe, expect, it } from 'vitest';
import { DEFAULT_MIC_PROCESSING, micProcessingSchema } from './mic-processing.js';

describe('micProcessingSchema', () => {
  it('accepts the default', () => {
    expect(micProcessingSchema.parse(DEFAULT_MIC_PROCESSING)).toEqual(DEFAULT_MIC_PROCESSING);
  });

  it('rejects an object missing a processor', () => {
    expect(
      micProcessingSchema.safeParse({ echoCancellation: true, noiseSuppression: true }).success,
    ).toBe(false);
  });

  it('keeps the default frozen so no caller can switch a processor off for everyone', () => {
    expect(Object.isFrozen(DEFAULT_MIC_PROCESSING)).toBe(true);
  });
});
