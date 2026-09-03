import { describe, expect, it } from 'vitest';
import {
  FakeAudioContext,
  FakeMediaStream,
  FakeWorkletNode,
} from '../conversation/fake-audio-context.js';
import { MicrophoneGraph, type MicrophoneGraphDeps } from './microphone-graph.js';

const WORKLET_URL = '/worklets/mic-capture-processor.js';

function harness(overrides: Partial<MicrophoneGraphDeps> = {}) {
  const context = new FakeAudioContext();
  const stream = new FakeMediaStream();
  const node = new FakeWorkletNode();
  const deps = {
    openMicrophone: () => Promise.resolve(stream as unknown as MediaStream),
    createAudioContext: () => context as unknown as AudioContext,
    createWorkletNode: () => node as unknown as AudioWorkletNode,
    workletUrl: WORKLET_URL,
    ...overrides,
  };
  return { context, stream, node, graph: new MicrophoneGraph(deps) };
}

/** One block of pure silence — the case this path must never withhold. */
const silence = (samples = 4800) => new Float32Array(samples);

/** A block loud enough that no plausible gate would drop it. */
function tone(samples = 4800): Float32Array {
  const block = new Float32Array(samples);
  for (let i = 0; i < samples; i++) block[i] = Math.sin(i / 4) * 0.8;
  return block;
}

describe('MicrophoneGraph', () => {
  it('loads the worklet the caller named and wires the microphone into it', async () => {
    const { context, graph, node } = harness();

    await graph.open(() => {});

    expect(context.addedModules).toEqual([WORKLET_URL]);
    expect(node.port.onmessage).not.toBeNull();
  });

  describe('what reaches the caller', () => {
    it('forwards a SILENT block — the live path has no gate', async () => {
      const { graph, node } = harness();
      const blocks: Int16Array[] = [];

      await graph.open((block) => blocks.push(block));
      node.deliver(silence());

      // The one assertion this whole class exists for. Withholding quiet audio
      // truncates the translation, because the backend learns an utterance
      // ended from trailing quiet rather than from any event.
      expect(blocks).toHaveLength(1);
      expect(blocks[0]!.length).toBeGreaterThan(0);
    });

    it('forwards every block, loud or quiet, in order', async () => {
      const { graph, node } = harness();
      const levels: number[] = [];

      await graph.open((_block, rms) => levels.push(rms));
      node.deliver(tone());
      node.deliver(silence());
      node.deliver(tone());

      expect(levels).toHaveLength(3);
      expect(levels[1]).toBe(0);
      expect(levels[0]).toBeGreaterThan(0);
      expect(levels[2]).toBeGreaterThan(0);
    });

    it('downsamples 48 kHz capture to the 16 kHz the backend takes', async () => {
      const { graph, node } = harness();
      const blocks: Int16Array[] = [];

      await graph.open((block) => blocks.push(block));
      node.deliver(tone(4800));

      // 48000 → 16000 is exactly 3:1.
      expect(blocks[0]!.length).toBe(1600);
    });

    it('reports a level derived from the block itself', async () => {
      const { graph, node } = harness();
      let seen = -1;

      await graph.open((_block, rms) => {
        seen = rms;
      });
      node.deliver(tone());

      expect(seen).toBeGreaterThan(0);
      expect(seen).toBeLessThanOrEqual(1);
    });
  });

  describe('mute', () => {
    it('stops the microphone but leaves the context open for trailing audio', async () => {
      const { context, graph, node, stream } = harness();

      await graph.open(() => {});
      graph.mute();

      expect(stream.tracks[0]!.stopped).toBe(1);
      expect(node.port.onmessage).toBeNull();
      expect(context.closed).toBe(0);
    });

    it('delivers nothing more once muted', async () => {
      const { graph, node } = harness();
      const blocks: Int16Array[] = [];

      await graph.open((block) => blocks.push(block));
      node.deliver(tone());
      graph.mute();
      node.deliver(tone());

      expect(blocks).toHaveLength(1);
    });
  });

  describe('close', () => {
    it('releases the track, the node and the context', async () => {
      const { context, graph, node, stream } = harness();

      await graph.open(() => {});
      graph.close();

      expect(stream.tracks[0]!.stopped).toBe(1);
      expect(node.disconnected).toBe(1);
      expect(context.closed).toBe(1);
    });

    it('is safe to call twice', async () => {
      const { context, graph } = harness();

      await graph.open(() => {});
      graph.close();
      expect(() => graph.close()).not.toThrow();

      expect(context.closed).toBe(1);
    });

    it('is safe before open, so a failed start can clean up blindly', () => {
      const { graph } = harness();

      expect(() => graph.close()).not.toThrow();
    });
  });

  /**
   * The extension hands this graph a context and a stream it does not own — the
   * context also carries the meeting's own passthrough and the other direction,
   * and the stream may be a captured tab. Releasing either would silence the
   * meeting permanently, and nothing about it would throw or fail a test.
   */
  describe('borrowed audio resources', () => {
    it('leaves the context open on close', async () => {
      const { context, graph, node } = harness({ ownsAudioResources: false });

      await graph.open(() => {});
      graph.close();

      // Still released: the node is this graph's own edge into the borrowed
      // context, and leaving it attached would keep the worklet fed.
      expect(node.disconnected).toBe(1);
      expect(context.closed).toBe(0);
    });

    it('leaves the tracks running on close and on mute', async () => {
      const { graph, stream } = harness({ ownsAudioResources: false });

      await graph.open(() => {});
      graph.mute();
      graph.close();

      expect(stream.tracks[0]!.stopped).toBe(0);
    });

    it('still stops delivering blocks once muted', async () => {
      const { graph, node } = harness({ ownsAudioResources: false });
      const blocks: Int16Array[] = [];

      // The whole promise of `mute` on a borrowed stream: capture stops for THIS
      // graph without the track ending for whoever else is reading it.
      await graph.open((block) => blocks.push(block));
      node.deliver(tone());
      graph.mute();
      node.deliver(tone());

      expect(blocks).toHaveLength(1);
    });
  });

  describe('optional denoise transform', () => {
    const DENOISE_URL = '/worklets/rnnoise-denoise-processor.js';

    function withDenoise() {
      const context = new FakeAudioContext();
      const stream = new FakeMediaStream();
      const capture = new FakeWorkletNode();
      const denoise = new FakeWorkletNode();
      const deps: MicrophoneGraphDeps = {
        openMicrophone: () => Promise.resolve(stream as unknown as MediaStream),
        createAudioContext: () => context as unknown as AudioContext,
        createWorkletNode: () => capture as unknown as AudioWorkletNode,
        workletUrl: WORKLET_URL,
        denoise: {
          workletUrl: DENOISE_URL,
          createNode: () => denoise as unknown as AudioWorkletNode,
        },
      };
      return { context, capture, denoise, graph: new MicrophoneGraph(deps) };
    }

    it('is absent by default: the microphone wires straight into capture', async () => {
      const { context, node, graph } = harness();

      await graph.open(() => {});

      expect(context.addedModules).toEqual([WORKLET_URL]);
      expect(context.micSources[0]!.connectedTo).toBe(node);
    });

    it('splices microphone → denoise → capture when supplied', async () => {
      const { context, capture, denoise, graph } = withDenoise();

      await graph.open(() => {});

      expect(context.addedModules).toEqual([WORKLET_URL, DENOISE_URL]);
      // The microphone feeds denoise, and denoise feeds capture — never the mic
      // straight into capture.
      expect(context.micSources[0]!.connectedTo).toBe(denoise);
      expect(denoise.connectedTo).toBe(capture);
    });

    it('still forwards every block, silence included — a transform is not a gate', async () => {
      const { capture, graph } = withDenoise();
      const blocks: Int16Array[] = [];

      await graph.open((block) => blocks.push(block));
      // Capture is still what posts blocks; denoise only cleans what flows into
      // it, so a silent block must still reach the caller.
      capture.deliver(silence());
      capture.deliver(tone());

      expect(blocks).toHaveLength(2);
    });

    it('releases the denoise node on close', async () => {
      const { denoise, graph } = withDenoise();

      await graph.open(() => {});
      graph.close();

      expect(denoise.disconnected).toBe(1);
    });
  });

  describe('failure to open', () => {
    it('propagates a denied microphone rather than swallowing it', async () => {
      const { graph } = harness({
        openMicrophone: () => Promise.reject(new Error('Permission denied')),
      });

      await expect(graph.open(() => {})).rejects.toThrow('Permission denied');
    });

    it('leaves close() able to release the context it already built', async () => {
      const { context, graph } = harness({
        openMicrophone: () => Promise.reject(new Error('Permission denied')),
      });

      await expect(graph.open(() => {})).rejects.toThrow();
      graph.close();

      expect(context.closed).toBe(1);
    });
  });
});
