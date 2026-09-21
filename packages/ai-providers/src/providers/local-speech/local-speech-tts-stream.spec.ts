import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

import {
  ProviderAbortedError,
  ProviderBusyError,
  ProviderConnectionError,
  ProviderResponseError,
} from '../../errors/provider-errors.js';
import { fetchStreamWithDeadlines } from '../fetch-stream-with-deadlines.js';
import { LOCAL_TTS_STREAM_MAX_CHARS } from '../http-util.js';
import { LocalSpeechTtsProvider } from './local-speech-tts-provider.js';

/**
 * Against a real HTTP server, because what matters here is what a socket does:
 * chunks that split a sample, a body cut off part-way, a caller walking away
 * while the sidecar is still queued. A mocked `fetch` would answer all of those
 * with whatever the mock was told to say.
 */

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

let server: Server | undefined;

afterEach(async () => {
  server?.closeAllConnections();
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
});

async function sidecar(handler: Handler): Promise<string> {
  server = createServer(handler);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

const pcmHeaders = { 'x-audio-encoding': 'pcm16', 'x-sample-rate': '48000' };

const request = {
  text: 'Xin chào',
  language: 'vi' as const,
  audioFormat: { encoding: 'pcm16' as const, sampleRate: 48000, channels: 1 as const },
};

async function collect(chunks: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const chunk of chunks) parts.push(Buffer.from(chunk));
  return Buffer.concat(parts);
}

describe('LocalSpeechTtsProvider.synthesizeStream', () => {
  it('delivers every byte, including chunks that split a sample', async () => {
    const url = await sidecar((_req, res) => {
      res.writeHead(200, pcmHeaders);
      res.write(Buffer.from([1, 2, 3]));
      setTimeout(() => res.end(Buffer.from([4, 5, 6, 7, 8])), 20);
    });

    const stream = await new LocalSpeechTtsProvider({ baseUrl: url }).synthesizeStream(
      request,
      new AbortController().signal,
    );

    expect(stream).toMatchObject({ encoding: 'pcm16', sampleRate: 48000 });
    expect([...(await collect(stream!.chunks))]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('sends the same body the whole-turn endpoint takes', async () => {
    let seen: unknown;
    const url = await sidecar((req, res) => {
      let raw = '';
      req.on('data', (d) => (raw += d));
      req.on('end', () => {
        seen = { path: req.url, body: JSON.parse(raw) };
        res.writeHead(200, pcmHeaders);
        res.end(Buffer.from([0, 0]));
      });
    });

    const stream = await new LocalSpeechTtsProvider({ baseUrl: url }).synthesizeStream(
      { ...request, voiceGender: 'male', speed: 1.2, voice: 'Thanh Bình' },
      new AbortController().signal,
    );
    await collect(stream!.chunks);

    expect(seen).toEqual({
      path: '/synthesize/stream',
      body: { text: 'Xin chào', language: 'vi', gender: 'male', speed: 1.2, voice: 'Thanh Bình' },
    });
  });

  it('answers null for a sidecar that has no stream endpoint', async () => {
    const url = await sidecar((_req, res) => {
      res.writeHead(404).end('{"detail":"Not Found"}');
    });

    await expect(
      new LocalSpeechTtsProvider({ baseUrl: url }).synthesizeStream(
        request,
        new AbortController().signal,
      ),
    ).resolves.toBeNull();
  });

  it('reports an error status with the sidecar detail', async () => {
    const url = await sidecar((_req, res) => {
      res.writeHead(503).end('{"detail":"models not loaded"}');
    });

    const attempt = new LocalSpeechTtsProvider({ baseUrl: url }).synthesizeStream(
      request,
      new AbortController().signal,
    );
    await expect(attempt).rejects.toBeInstanceOf(ProviderResponseError);
    await expect(attempt).rejects.not.toBeInstanceOf(ProviderBusyError);
    await expect(attempt).rejects.toThrow(/503.*not loaded/);
  });

  it('reports a 503 marked busy as the engine being busy, on both endpoints', async () => {
    const url = await sidecar((_req, res) => {
      res
        .writeHead(503, { 'x-engine-busy': '1' })
        .end('{"detail":"vi engine busy for more than 15s"}');
    });
    const provider = new LocalSpeechTtsProvider({ baseUrl: url });

    const streamed = provider.synthesizeStream(request, new AbortController().signal);
    await expect(streamed).rejects.toBeInstanceOf(ProviderBusyError);
    await expect(streamed).rejects.toMatchObject({ status: 503 });
    await expect(provider.synthesize(request)).rejects.toBeInstanceOf(ProviderBusyError);
  });

  it('answers null without a request for text past the stream cap', async () => {
    let requests = 0;
    const url = await sidecar((_req, res) => {
      requests += 1;
      res.writeHead(422).end();
    });

    await expect(
      new LocalSpeechTtsProvider({ baseUrl: url }).synthesizeStream(
        { ...request, text: 'a'.repeat(LOCAL_TTS_STREAM_MAX_CHARS + 1) },
        new AbortController().signal,
      ),
    ).resolves.toBeNull();
    expect(requests).toBe(0);
  });

  it.each([
    ['a missing encoding', { 'x-sample-rate': '48000' }],
    ['a container instead of PCM', { 'x-audio-encoding': 'wav', 'x-sample-rate': '48000' }],
    ['a rate that is not an integer', { 'x-audio-encoding': 'pcm16', 'x-sample-rate': '48000.5' }],
    ['a rate outside the wire contract', { 'x-audio-encoding': 'pcm16', 'x-sample-rate': '96000' }],
  ])('refuses %s before handing on any audio', async (_label, headers) => {
    const url = await sidecar((_req, res) => {
      res.writeHead(200, headers).end(Buffer.from([1, 2]));
    });

    await expect(
      new LocalSpeechTtsProvider({ baseUrl: url }).synthesizeStream(
        request,
        new AbortController().signal,
      ),
    ).rejects.toBeInstanceOf(ProviderResponseError);
  });

  it('reports a body cut off part-way as a connection failure, not an ending', async () => {
    const url = await sidecar((_req, res) => {
      res.writeHead(200, pcmHeaders);
      res.write(Buffer.from([1, 2]));
      setTimeout(() => res.socket?.destroy(), 20);
    });

    const stream = await new LocalSpeechTtsProvider({ baseUrl: url }).synthesizeStream(
      request,
      new AbortController().signal,
    );
    await expect(collect(stream!.chunks)).rejects.toBeInstanceOf(ProviderConnectionError);
  });

  it('reports the caller leaving while queued as an abort, not a timeout', async () => {
    const url = await sidecar(() => {
      // Queued behind another turn: no headers yet.
    });
    const caller = new AbortController();
    setTimeout(() => caller.abort(), 30);

    await expect(
      new LocalSpeechTtsProvider({ baseUrl: url }).synthesizeStream(request, caller.signal),
    ).rejects.toBeInstanceOf(ProviderAbortedError);
  });

  it('reports the caller leaving mid-stream as an abort', async () => {
    const url = await sidecar((_req, res) => {
      res.writeHead(200, pcmHeaders);
      res.write(Buffer.from([1, 2]));
    });
    const caller = new AbortController();

    const stream = await new LocalSpeechTtsProvider({ baseUrl: url }).synthesizeStream(
      request,
      caller.signal,
    );
    setTimeout(() => caller.abort(), 30);
    await expect(collect(stream!.chunks)).rejects.toBeInstanceOf(ProviderAbortedError);
  });
});

describe('fetchStreamWithDeadlines', () => {
  const deadlines = (
    overrides: Partial<{ firstByteMs: number; idleMs: number; totalMs: number }>,
  ) => ({
    firstByteMs: 5_000,
    idleMs: 5_000,
    totalMs: 5_000,
    signal: new AbortController().signal,
    ...overrides,
  });

  it('times out waiting for the first byte', async () => {
    const url = await sidecar(() => undefined);
    await expect(
      fetchStreamWithDeadlines(url, {}, deadlines({ firstByteMs: 50 }), 'probe'),
    ).rejects.toThrow(/probe timed out after 50ms waiting for audio/);
  });

  it('times out when a live stream goes quiet', async () => {
    const url = await sidecar((_req, res) => {
      res.writeHead(200);
      res.write('x');
    });
    const { chunks } = await fetchStreamWithDeadlines(url, {}, deadlines({ idleMs: 50 }), 'probe');
    await expect(collect(chunks)).rejects.toThrow(/probe stalled for more than 50ms/);
  });

  it('cuts off a stream that keeps talking past the total ceiling', async () => {
    const url = await sidecar((_req, res) => {
      res.writeHead(200);
      const timer = setInterval(() => res.write('x'), 10);
      res.on('close', () => clearInterval(timer));
    });
    const { chunks } = await fetchStreamWithDeadlines(
      url,
      {},
      deadlines({ idleMs: 1_000, totalMs: 100 }),
      'probe',
    );
    await expect(collect(chunks)).rejects.toThrow(/probe timed out after 100ms in total/);
  });

  it('closes the request when the consumer stops reading early', async () => {
    let closed = false;
    const url = await sidecar((_req, res) => {
      res.writeHead(200);
      const timer = setInterval(() => res.write('x'), 10);
      res.on('close', () => {
        clearInterval(timer);
        closed = true;
      });
    });
    const { chunks } = await fetchStreamWithDeadlines(url, {}, deadlines({}), 'probe');
    for await (const _chunk of chunks) break;

    await expect.poll(() => closed).toBe(true);
  });
});
