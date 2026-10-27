import { describe, expect, it, vi } from 'vitest';
import { pushedCaptureDeps, type PushedPcmSource } from './pushed-pcm-capture.js';
import { ConversationSession } from '../conversation/conversation-session.js';
import { FakeTranslateSocket } from '../conversation/fake-audio-context.js';
import type { TranslateSocket } from '../transport/translate-socket.js';

/** A recorder the test pushes buffers through. */
class FakeSource implements PushedPcmSource {
  private onBuffer: ((samples: Float32Array, rate: number) => void) | null = null;
  started = 0;
  stopped = 0;
  readonly paused: boolean[] = [];

  start(onBuffer: (samples: Float32Array, rate: number) => void): Promise<void> {
    this.started += 1;
    this.onBuffer = onBuffer;
    return Promise.resolve();
  }

  stop(): Promise<void> {
    this.stopped += 1;
    return Promise.resolve();
  }

  setPaused(paused: boolean): void {
    this.paused.push(paused);
  }

  push(samples: Float32Array, rate: number): void {
    this.onBuffer?.(samples, rate);
  }
}

/** Open the graph the way the session does, collecting every posted block. */
async function open(source = new FakeSource()) {
  const deps = pushedCaptureDeps(source);
  const context = deps.createAudioContext();
  await context.audioWorklet.addModule(deps.workletUrl);
  const stream = await deps.openMicrophone();
  const node = deps.createWorkletNode(context);
  const blocks: Float32Array[] = [];
  node.port.onmessage = (event: MessageEvent<Float32Array>) => blocks.push(event.data);
  const edge = context.createMediaStreamSource(stream);
  edge.connect(node);
  return { source, deps, context, stream, node, edge, blocks };
}

const ramp = (length: number, from = 0): Float32Array =>
  Float32Array.from({ length }, (_, i) => (from + i) / 100_000);

describe('pushedCaptureDeps', () => {
  it('reports 48 kHz, so the session derives the same ~21 ms block as on web', async () => {
    const h = await open();
    expect(h.context.sampleRate).toBe(48000);
  });

  it('rechunks uneven 48 kHz buffers into exact 1024-sample blocks, unchanged', async () => {
    const h = await open();
    const sizes = [1600, 333, 4096];
    let from = 0;
    for (const size of sizes) {
      h.source.push(ramp(size, from), 48000);
      from += size;
    }

    const total = sizes.reduce((a, b) => a + b, 0);
    expect(h.blocks).toHaveLength(Math.floor(total / 1024));
    expect(h.blocks.every((block) => block.length === 1024)).toBe(true);
    const joined = h.blocks.flatMap((block) => [...block]);
    expect(joined).toEqual([...ramp(joined.length)]);
  });

  it('resamples 16 kHz to 48 kHz across buffer boundaries, still in 1024-sample blocks', async () => {
    const h = await open();
    let from = 0;
    for (const size of [1600, 333, 4096, 1600]) {
      h.source.push(ramp(size, from), 16000);
      from += size;
    }

    expect(h.blocks.every((block) => block.length === 1024)).toBe(true);
    // Three output samples per input sample, give or take what is still carried.
    const out = h.blocks.length * 1024;
    expect(out).toBeGreaterThan(from * 3 - 1024 - 3);
    expect(out).toBeLessThanOrEqual(from * 3);
    // A ramp stays a ramp: each output is a third of an input step past the last,
    // including across every boundary between buffers.
    const joined = h.blocks.flatMap((block) => [...block]);
    for (let i = 1; i < joined.length; i += 1) {
      expect(joined[i]! - joined[i - 1]!).toBeCloseTo(1 / 300_000, 6);
    }
  });

  it('posts nothing once the edge is disconnected', async () => {
    const h = await open();
    h.edge.disconnect();
    h.source.push(new Float32Array(4096), 48000);
    expect(h.blocks).toHaveLength(0);
  });

  it('posts nothing once the node is disconnected or the context closed', async () => {
    const a = await open();
    a.node.disconnect();
    a.source.push(new Float32Array(4096), 48000);

    const b = await open();
    await b.context.close();
    b.source.push(new Float32Array(4096), 48000);

    expect(a.blocks).toHaveLength(0);
    expect(b.blocks).toHaveLength(0);
  });

  it('stops the recorder when the stream track is stopped, and posts nothing after', async () => {
    const h = await open();
    expect(h.stream.getAudioTracks()).toHaveLength(1);

    h.stream.getTracks().forEach((track) => track.stop());
    h.source.push(new Float32Array(4096), 48000);

    expect(h.source.stopped).toBe(1);
    expect(h.blocks).toHaveLength(0);
  });

  it('drops audio while paused, at the shim and at the source', async () => {
    const h = await open();
    h.deps.setPaused?.(true);
    h.source.push(new Float32Array(4096), 48000);
    h.deps.setPaused?.(false);
    h.source.push(new Float32Array(2048), 48000);

    expect(h.blocks).toHaveLength(2);
    expect(h.source.paused).toEqual([false, true, false]);
  });

  it('runs the real session: speech pushed at 16 kHz opens a turn, and stop releases the recorder', async () => {
    const source = new FakeSource();
    const sockets: FakeTranslateSocket[] = [];
    const session = new ConversationSession(
      {
        ...pushedCaptureDeps(source),
        createSocket: (handlers) => {
          const socket = new FakeTranslateSocket(handlers);
          sockets.push(socket);
          return socket as unknown as TranslateSocket;
        },
        // Nothing may play here; the shim's context has no output to play into.
        createPlaybackSink: () => ({
          enqueue: vi.fn(),
          isPlayingTurn: () => false,
          isPlaying: false,
          stop: vi.fn(),
          stopTurn: vi.fn(),
        }),
      },
      {
        onStatus: vi.fn(),
        onLevel: vi.fn(),
        onMuted: vi.fn(),
        onError: vi.fn(),
        onEchoHeard: vi.fn(),
        onServerEvent: vi.fn(),
        onReset: vi.fn(),
      },
      () => ({ continuous: true, maxInFlight: 3, fullDuplex: true }),
    );

    await session.start({ languagePair: { source: 'vi', target: 'en' }, voiceGender: 'female' });
    // 400 ms of a loud tone in odd-sized 16 kHz buffers.
    for (let i = 0; i < 20; i += 1) {
      source.push(
        Float32Array.from({ length: 320 }, (_, k) => Math.sin((i * 320 + k) / 3) * 0.25),
        16000,
      );
    }

    expect(sockets[0]!.sent.some((e) => e.type === 'client.session.start')).toBe(true);

    session.stop();
    expect(source.stopped).toBe(1);
  });
});
