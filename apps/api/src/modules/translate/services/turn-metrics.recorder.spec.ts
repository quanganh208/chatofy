import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TurnMetricsRecorder, type TurnMetrics } from './turn-metrics.recorder';

const row = (overrides: Partial<TurnMetrics> = {}): TurnMetrics => ({
  sessionId: 'c75158bd',
  languagePair: { source: 'en', target: 'vi' },
  completed: true,
  inputBytes: 111232,
  inputSampleRate: 16000,
  targetChars: 9,
  clauses: 1,
  ttsDelivery: 'stream',
  speculationUsed: true,
  speculations: 2,
  liveTranslations: 2,
  quotaCooldowns: 0,
  reanchors: 0,
  committedChars: 0,
  translatedAtMs: 988,
  firstAudioAtMs: 2596,
  lastAudioAtMs: 4000,
  ...overrides,
});

describe('TurnMetricsRecorder', () => {
  afterEach(() => vi.restoreAllMocks());

  it('appends how the final was produced, as counts and never text', () => {
    const log = vi
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    new TurnMetricsRecorder().record(
      row({
        finalSource: {
          src: 'speculation',
          bytes: 111232,
          specAtBytes: 111232,
          chars: 9,
          words: 1,
          speechMs: 3354,
        },
      }),
    );

    const line = String(log.mock.calls[0]?.[0]);
    expect(line).toContain(
      'final=speculation bytes=111232 specAt=111232 chars=9 words=1 speechMs=3354',
    );
    expect(line).not.toContain('politics');
  });

  it('writes the line it always wrote when the turn had no final', () => {
    const log = vi
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    new TurnMetricsRecorder().record(
      row({ completed: false, reason: 'no_audio' }),
    );

    const line = String(log.mock.calls[0]?.[0]);
    expect(line).toMatch(/live=2$/);
    expect(line).not.toContain('final=');
  });

  it('marks a missing guess offset and speech measure with a dash', () => {
    const log = vi
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    new TurnMetricsRecorder().record(
      row({ finalSource: { src: 'fresh', bytes: 10, chars: 5, words: 1 } }),
    );

    expect(String(log.mock.calls[0]?.[0])).toContain(
      'final=fresh bytes=10 specAt=- chars=5 words=1 speechMs=-',
    );
  });
});
