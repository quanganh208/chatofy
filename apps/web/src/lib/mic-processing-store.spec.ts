// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MIC_PROCESSING } from '@chatofy/types';
import {
  MIC_PROCESSING_STORAGE_KEY,
  carryLegacyMicProcessing,
  loadMicProcessing,
  saveMicProcessing,
  subscribeMicProcessing,
} from './mic-processing-store';

/**
 * The microphone chain stays on the device, and a device that had one set before
 * preferences moved to the account keeps it.
 */
const LEGACY = 'chatofy.translate-settings';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('the microphone chain', () => {
  it('keeps every processor on when nothing is stored', () => {
    expect(loadMicProcessing()).toEqual(DEFAULT_MIC_PROCESSING);
  });

  it('reads one stored processor and keeps the others on', () => {
    localStorage.setItem(MIC_PROCESSING_STORAGE_KEY, JSON.stringify({ echoCancellation: false }));
    expect(loadMicProcessing()).toEqual({ ...DEFAULT_MIC_PROCESSING, echoCancellation: false });
  });

  it('falls back per processor, and wholesale for a value that is not an object', () => {
    localStorage.setItem(
      MIC_PROCESSING_STORAGE_KEY,
      JSON.stringify({ echoCancellation: 'no', noiseSuppression: false, voiceIsolation: true }),
    );
    expect(loadMicProcessing()).toEqual({ ...DEFAULT_MIC_PROCESSING, noiseSuppression: false });
    localStorage.setItem(MIC_PROCESSING_STORAGE_KEY, '7');
    expect(loadMicProcessing()).toEqual(DEFAULT_MIC_PROCESSING);
    localStorage.setItem(MIC_PROCESSING_STORAGE_KEY, '{not json');
    expect(loadMicProcessing()).toEqual(DEFAULT_MIC_PROCESSING);
  });

  it('hands back the same object until the stored value changes', () => {
    // `useSyncExternalStore` re-renders forever on a fresh object per read.
    expect(loadMicProcessing()).toBe(loadMicProcessing());
  });

  it('survives storage that throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(loadMicProcessing()).toEqual(DEFAULT_MIC_PROCESSING);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => saveMicProcessing(DEFAULT_MIC_PROCESSING)).not.toThrow();
  });

  it('tells subscribers about a save in this tab', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeMicProcessing(listener);
    saveMicProcessing({ ...DEFAULT_MIC_PROCESSING, autoGainControl: false });
    expect(listener).toHaveBeenCalledOnce();
    expect(loadMicProcessing().autoGainControl).toBe(false);
    unsubscribe();
  });
});

describe('the chain an older build kept inside its settings', () => {
  const legacy = { textSize: 4, micProcessing: { echoCancellation: false } };

  it('is read while the new key is absent', () => {
    localStorage.setItem(LEGACY, JSON.stringify(legacy));
    expect(loadMicProcessing().echoCancellation).toBe(false);
  });

  it('is carried to its own key once, and not over a newer choice', () => {
    localStorage.setItem(LEGACY, JSON.stringify(legacy));
    carryLegacyMicProcessing();
    expect(JSON.parse(localStorage.getItem(MIC_PROCESSING_STORAGE_KEY)!)).toEqual({
      ...DEFAULT_MIC_PROCESSING,
      echoCancellation: false,
    });

    saveMicProcessing(DEFAULT_MIC_PROCESSING);
    carryLegacyMicProcessing();
    expect(loadMicProcessing()).toEqual(DEFAULT_MIC_PROCESSING);
  });

  it('carries nothing when the old settings held no chain', () => {
    localStorage.setItem(LEGACY, JSON.stringify({ textSize: 4 }));
    carryLegacyMicProcessing();
    expect(localStorage.getItem(MIC_PROCESSING_STORAGE_KEY)).toBeNull();
  });
});
