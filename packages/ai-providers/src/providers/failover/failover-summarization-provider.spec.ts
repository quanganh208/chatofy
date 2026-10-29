import { describe, expect, it, vi } from 'vitest';

import { ProviderResponseError } from '../../errors/provider-errors.js';
import type {
  MeetingMinutesDraft,
  SummarizationProvider,
} from '../../interfaces/summarization-provider.js';
import { FailoverSummarizationProvider } from './failover-summarization-provider.js';
import { HostCircuit } from './host-circuit.js';

const USAGE_LIMIT = new ProviderResponseError(
  'commandcode answered 429: {"error":{"message":"You\'ve reached your 5-hour usage limit","code":"RATE_LIMITED"}}',
  429,
);
const UPSTREAM_BUSY = new ProviderResponseError(
  'commandcode answered 429: Upstream model provider is temporarily unavailable',
  429,
);

const draft = (model: string): MeetingMinutesDraft => ({
  summary: 's',
  keyPoints: [],
  decisions: [],
  actionItems: [],
  model,
});

function fake(name: string, run: SummarizationProvider['summarize']) {
  return { name, summarize: vi.fn(run) } satisfies SummarizationProvider;
}

const request = { transcript: 'An: hi' };

function build(primaryRun: SummarizationProvider['summarize'], withSecondary = true) {
  const circuit = new HostCircuit();
  const primary = fake('primary', primaryRun);
  const secondary = withSecondary ? fake('secondary', async () => draft('gemini')) : null;
  const provider = new FailoverSummarizationProvider({
    name: 'minutes',
    primary,
    secondary,
    circuit,
  });
  return { circuit, primary, secondary, provider };
}

describe('FailoverSummarizationProvider', () => {
  it('answers from the primary when it answers', async () => {
    const { provider, secondary } = build(async () => draft('cc'));
    await expect(provider.summarize(request)).resolves.toMatchObject({ model: 'cc' });
    expect(secondary!.summarize).not.toHaveBeenCalled();
  });

  it('falls back on a spent usage window and opens the circuit', async () => {
    const { provider, circuit } = build(async () => {
      throw USAGE_LIMIT;
    });
    await expect(provider.summarize(request)).resolves.toMatchObject({ model: 'gemini' });
    expect(circuit.isOpen()).toBe(true);
  });

  it('falls back on a transient 429 or a bad answer without opening the circuit', async () => {
    for (const err of [UPSTREAM_BUSY, new ProviderResponseError('returned non-JSON minutes')]) {
      const { provider, circuit } = build(async () => {
        throw err;
      });
      await expect(provider.summarize(request)).resolves.toMatchObject({ model: 'gemini' });
      expect(circuit.isOpen()).toBe(false);
    }
  });

  it('opens the circuit on a rejected key', async () => {
    const { provider, circuit } = build(async () => {
      throw new ProviderResponseError('unauthorized', 401);
    });
    await expect(provider.summarize(request)).resolves.toMatchObject({ model: 'gemini' });
    expect(circuit.isOpen()).toBe(true);
  });

  it('skips the primary while the circuit is open', async () => {
    const { provider, circuit, primary } = build(async () => draft('cc'));
    circuit.trip('usage limit');
    await expect(provider.summarize(request)).resolves.toMatchObject({ model: 'gemini' });
    expect(primary.summarize).not.toHaveBeenCalled();
  });

  it('rethrows the primary error when there is nothing behind it', async () => {
    const { provider } = build(async () => {
      throw USAGE_LIMIT;
    }, false);
    await expect(provider.summarize(request)).rejects.toBe(USAGE_LIMIT);
  });

  it('still asks the primary with nothing behind it, even with the circuit open', async () => {
    const { provider, circuit, primary } = build(async () => draft('cc'), false);
    circuit.trip('usage limit');
    await expect(provider.summarize(request)).resolves.toMatchObject({ model: 'cc' });
    expect(primary.summarize).toHaveBeenCalledOnce();
  });
});
