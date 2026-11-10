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

  it('appends the stage timings in a fixed order, skipping the stages a turn never reached', () => {
    const log = vi
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    new TurnMetricsRecorder().record(
      row({
        // Given out of order on purpose: the line's order is the stages', not the map's.
        stages: { lineSent: 360, mtDone: 340, sttDone: 12 },
        speculationInFlightAtEnd: true,
        correctionsLate: true,
      }),
    );

    const line = String(log.mock.calls[0]?.[0]);
    expect(line).toContain('stages=sttDone:12,mtDone:340,lineSent:360');
    expect(line).toContain('lastAudio=4000ms');
    expect(line).toMatch(/ inflight=yes corrLate=yes$/);
  });

  it('says no for a turn that was not in flight and whose checks were on time', () => {
    const log = vi
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    new TurnMetricsRecorder().record(
      row({ stages: { sttDone: -40, alternateWait: 87 } }),
    );

    expect(String(log.mock.calls[0]?.[0])).toContain(
      'stages=sttDone:-40,alternateWait:87 inflight=no corrLate=no',
    );
  });

  it('appends the split-candidate flag and the fusion count only where the turn reached them', () => {
    const log = vi
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    const recorder = new TurnMetricsRecorder();
    recorder.record(
      row({ stages: {}, splitCandidate: true, fusedCorrections: 0 }),
    );
    recorder.record(
      row({ stages: {}, splitCandidate: false, fusedCorrections: 2 }),
    );
    recorder.record(row({ stages: {} }));

    const lines = log.mock.calls.map((call) => String(call[0]));
    expect(lines[0]).toMatch(/ corrLate=no cand=yes fused=0$/);
    expect(lines[1]).toMatch(/ corrLate=no cand=no fused=2$/);
    expect(lines[2]).toMatch(/ corrLate=no$/);
  });
});
