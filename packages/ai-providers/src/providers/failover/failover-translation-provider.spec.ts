import { describe, expect, it, vi } from 'vitest';

import { ProviderResponseError } from '../../errors/provider-errors.js';
import type {
  TranslationProvider,
  TranslationRequest,
} from '../../interfaces/translation-provider.js';
import { FailoverTranslationProvider } from './failover-translation-provider.js';
import { HostCircuit } from './host-circuit.js';

const USAGE_LIMIT = new ProviderResponseError(
  'commandcode answered 429: {"error":{"message":"You\'ve reached your 5-hour usage limit","code":"RATE_LIMITED"}}',
  429,
);
const UPSTREAM_BUSY = new ProviderResponseError(
  'commandcode answered 429: Upstream model provider is temporarily unavailable',
  429,
);

const request: TranslationRequest = {
  text: 'xin chào',
  sourceLanguage: 'vi',
  targetLanguage: 'en',
  models: ['deepseek/deepseek-v4-flash-fast'],
};

function fake(name: string, run: TranslationProvider['translate']) {
  return { name, translate: vi.fn(run) } satisfies TranslationProvider;
}

function build(primaryRun: TranslationProvider['translate']) {
  const circuit = new HostCircuit();
  const primary = fake('primary', primaryRun);
  const secondary = fake('secondary', async (req) => {
    req.onChunk?.('hello', true);
    return { text: 'hello', model: 'deepseek-flash' };
  });
  const provider = new FailoverTranslationProvider({
    name: 'commandcode',
    primary,
    secondary,
    circuit,
  });
  return { circuit, primary, secondary, provider };
}

describe('FailoverTranslationProvider', () => {
  it('answers from the primary when it answers', async () => {
    const { provider, secondary } = build(async () => ({ text: 'hi', model: 'p' }));
    await expect(provider.translate(request)).resolves.toEqual({ text: 'hi', model: 'p' });
    expect(secondary.translate).not.toHaveBeenCalled();
  });

  it('falls back on a spent usage window and opens the circuit', async () => {
    const { provider, circuit, secondary } = build(async () => {
      throw USAGE_LIMIT;
    });
    await expect(provider.translate(request)).resolves.toMatchObject({ text: 'hello' });
    expect(circuit.isOpen()).toBe(true);
    // The secondary serves its own model, never the primary's ladder.
    expect(secondary.translate.mock.calls[0]![0].models).toBeUndefined();
  });

  it('falls back on a transient 429 without opening the circuit', async () => {
    const { provider, circuit } = build(async () => {
      throw UPSTREAM_BUSY;
    });
    await expect(provider.translate(request)).resolves.toMatchObject({ text: 'hello' });
    expect(circuit.isOpen()).toBe(false);
  });

  it('falls back on a 400 without opening the circuit', async () => {
    const { provider, circuit } = build(async () => {
      throw new ProviderResponseError('bad field', 400);
    });
    await expect(provider.translate(request)).resolves.toMatchObject({ text: 'hello' });
    expect(circuit.isOpen()).toBe(false);
  });

  it('opens the circuit on a rejected key', async () => {
    const { provider, circuit } = build(async () => {
      throw new ProviderResponseError('unauthorized', 401);
    });
    await expect(provider.translate(request)).resolves.toMatchObject({ text: 'hello' });
    expect(circuit.isOpen()).toBe(true);
  });

  it('skips the primary entirely while the circuit is open', async () => {
    const { provider, circuit, primary } = build(async () => ({ text: 'hi', model: 'p' }));
    circuit.trip('usage limit');
    await expect(provider.translate(request)).resolves.toMatchObject({ text: 'hello' });
    expect(primary.translate).not.toHaveBeenCalled();
  });

  it('asks the primary again once the cooldown has passed', async () => {
    let now = 0;
    const circuit = new HostCircuit({ cooldownMs: 1000, now: () => now });
    const primary = fake('primary', async () => ({ text: 'hi', model: 'p' }));
    const secondary = fake('secondary', async () => ({ text: 'hello', model: 's' }));
    const provider = new FailoverTranslationProvider({ name: 'cc', primary, secondary, circuit });
    circuit.trip('usage limit');
    await provider.translate(request);
    now = 1000;
    await expect(provider.translate(request)).resolves.toMatchObject({ text: 'hi' });
    expect(primary.translate).toHaveBeenCalledTimes(1);
  });

  it('restarts the stream when the primary failed part-way through it', async () => {
    const chunks: [string, boolean][] = [];
    const circuit = new HostCircuit();
    const primary = fake('primary', async (req) => {
      req.onChunk?.('hal', true);
      throw new ProviderResponseError('stream broke', 503);
    });
    // A secondary that does NOT announce its own restart, to prove the wrapper does.
    const secondary = fake('secondary', async (req) => {
      req.onChunk?.('hello', false);
      req.onChunk?.('hello there', false);
      return { text: 'hello there', model: 's' };
    });
    const provider = new FailoverTranslationProvider({ name: 'cc', primary, secondary, circuit });
    await provider.translate({ ...request, onChunk: (d, r) => chunks.push([d, r]) });
    expect(chunks).toEqual([
      ['hal', true],
      ['hello', true],
      ['hello there', false],
    ]);
  });

  it('throws the secondary error when both hosts fail', async () => {
    const circuit = new HostCircuit();
    const primary = fake('primary', async () => {
      throw USAGE_LIMIT;
    });
    const secondaryError = new ProviderResponseError('deepseek down', 503);
    const secondary = fake('secondary', async () => {
      throw secondaryError;
    });
    const provider = new FailoverTranslationProvider({ name: 'cc', primary, secondary, circuit });
    await expect(provider.translate(request)).rejects.toBe(secondaryError);
  });
});
