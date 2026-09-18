import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProviderResponseError } from '../../errors/provider-errors.js';
import { LocalSpeechEmbeddingProvider } from './local-speech-embedding-provider.js';

/**
 * What the sidecar says, and what this provider decides to believe.
 *
 * Both halves matter and they fail differently. A vector it cannot use is
 * rejected outright, because an empty one scores 0 against every centroid and
 * reads downstream as "nobody recognised" — a plausible answer, and the wrong
 * one. A missing `speechMs` is not rejected: it reads 0, which is under every
 * floor a consumer can set, so the turn is withheld rather than placed on a
 * number nobody supplied.
 */

const audio = new Uint8Array([1, 2, 3, 4]);
const REAL_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = REAL_FETCH;
  vi.restoreAllMocks();
});

const answering = (body: unknown) => {
  globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => body });
};

const provider = () => new LocalSpeechEmbeddingProvider({ baseUrl: 'http://localhost:8002' });

describe('LocalSpeechEmbeddingProvider', () => {
  it('returns the vector, its dimension and how much speech it was built from', async () => {
    answering({ vector: [0.6, 0.8], dim: 2, speechMs: 1480 });

    await expect(provider().embed(audio, 'audio/wav')).resolves.toEqual({
      vector: [0.6, 0.8],
      dim: 2,
      speechMs: 1480,
    });
  });

  it('reads a missing speech duration as none, rather than failing the turn', async () => {
    // A sidecar too old to measure it. Zero is under every floor, so the turn
    // goes unattributed — it costs a label, which is what this provider is for,
    // and not the turn, which it is not.
    answering({ vector: [0.6, 0.8], dim: 2 });

    await expect(provider().embed(audio, 'audio/wav')).resolves.toMatchObject({ speechMs: 0 });
  });

  it('reads a speech duration that is not a number as none either', async () => {
    // The shape that would otherwise reach a comparison and answer it wrongly:
    // `undefined < floor` is false, so an unchecked value lets exactly the turns
    // the floor exists to stop straight through.
    answering({ vector: [0.6, 0.8], dim: 2, speechMs: '1480' });

    await expect(provider().embed(audio, 'audio/wav')).resolves.toMatchObject({ speechMs: 0 });
  });

  it('still refuses a response with no usable vector', async () => {
    answering({ vector: [], dim: 0, speechMs: 1480 });

    await expect(provider().embed(audio, 'audio/wav')).rejects.toBeInstanceOf(
      ProviderResponseError,
    );
  });
});
