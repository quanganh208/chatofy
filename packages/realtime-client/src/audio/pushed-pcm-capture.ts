import type { ConversationSessionDeps } from '../conversation/conversation-session.js';

/**
 * A microphone that PUSHES buffers, presented to `ConversationSession` as the
 * Web Audio graph it expects.
 *
 * React Native has no `AudioContext` the session can use, but a native recorder
 * can hand over Float32 buffers. Rather than teach the session a second capture
 * path, this fakes exactly the surface it touches — `audioWorklet.addModule`,
 * `sampleRate`, `createMediaStreamSource(stream).connect(node)`, the node's
 * `port.onmessage` and `disconnect()`, the stream's tracks, `close()` — so the
 * turn-taking policy that runs on mobile is the one web runs, line for line.
 *
 * The context REPORTS 48 kHz and every block it posts is exactly 1024 samples
 * at 48 kHz, whatever the recorder delivers. That is not cosmetic: the session
 * sizes its capture blocks from these two numbers (~21 ms each), and the speech
 * gate's confirmation and hangover constants were tuned at that block size. A
 * 16 kHz recorder reported as-is would give 64 ms blocks and a gate that
 * confirms and hangs over at different points than on web.
 */

/** What the session's block arithmetic assumes; see the file comment. */
const REPORTED_SAMPLE_RATE = 48_000;
/** Samples per posted block, as the browser worklet posts them. */
const BLOCK_SAMPLES = 1024;

/** A recorder that pushes buffers of Float32 samples in [-1, 1]. */
export interface PushedPcmSource {
  start(onBuffer: (samples: Float32Array, sampleRate: number) => void): Promise<void>;
  stop(): Promise<void>;
  /** Drop audio at the source while muted. Optional: the shim also drops it. */
  setPaused?(paused: boolean): void;
}

/** The capture half of {@link ConversationSessionDeps}, plus a mute the caller can reach. */
export type CaptureDeps = Pick<
  ConversationSessionDeps,
  | 'openMicrophone'
  | 'createAudioContext'
  | 'createWorkletNode'
  | 'workletUrl'
  | 'ownsAudioResources'
> & {
  /** Stop or restart delivering blocks without tearing anything down. */
  setPaused?(paused: boolean): void;
};

/**
 * Linear resampler with state carried across calls, so a buffer boundary is not
 * a discontinuity. Converts any input rate to {@link REPORTED_SAMPLE_RATE}.
 */
class LinearUpsampler {
  /** Position of the next output sample, in input samples from the current buffer's start. */
  private position = 0;
  /** The previous buffer's last sample: index -1 of the current one. */
  private previous = 0;
  private rate = 0;

  push(input: Float32Array, rate: number): Float32Array {
    if (rate === REPORTED_SAMPLE_RATE) return input.slice();
    if (rate !== this.rate) {
      this.rate = rate;
      this.position = 0;
      this.previous = 0;
    }
    if (input.length === 0) return new Float32Array(0);

    const step = rate / REPORTED_SAMPLE_RATE;
    const last = input.length - 1;
    const out: number[] = [];
    while (this.position <= last) {
      const index = Math.floor(this.position);
      const frac = this.position - index;
      const a = index < 0 ? this.previous : input[index]!;
      const b = index + 1 <= last ? input[index + 1]! : a;
      out.push(a + (b - a) * frac);
      this.position += step;
    }
    this.position -= input.length;
    this.previous = input[last]!;
    return Float32Array.from(out);
  }
}

type BlockListener = ((event: { data: Float32Array }) => void) | null;

/** Stands in for the `AudioWorkletNode` the session reads blocks from. */
class PushedWorkletNode {
  readonly port: { onmessage: BlockListener } = { onmessage: null };
  disconnected = false;

  disconnect(): void {
    this.disconnected = true;
  }
}

/** One opened microphone: the recorder's buffers, rechunked and resampled. */
class PushedStream {
  target: PushedWorkletNode | null = null;
  context: PushedContext | null = null;
  private stopped = false;
  private paused = false;
  private carry = new Float32Array(0);
  private readonly upsampler = new LinearUpsampler();
  private readonly track = { kind: 'audio', stop: () => this.stop() };

  constructor(private readonly source: PushedPcmSource) {}

  getTracks(): { kind: string; stop: () => void }[] {
    return [this.track];
  }

  getAudioTracks(): { kind: string; stop: () => void }[] {
    return [this.track];
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    // What was half-collected before a mute must not open the next unmuted block.
    if (paused) this.carry = new Float32Array(0);
  }

  accept = (samples: Float32Array, sampleRate: number): void => {
    if (this.stopped || this.paused) return;
    const resampled = this.upsampler.push(samples, sampleRate);
    const joined = new Float32Array(this.carry.length + resampled.length);
    joined.set(this.carry);
    joined.set(resampled, this.carry.length);
    let offset = 0;
    while (joined.length - offset >= BLOCK_SAMPLES) {
      this.post(joined.slice(offset, offset + BLOCK_SAMPLES));
      offset += BLOCK_SAMPLES;
    }
    this.carry = joined.slice(offset);
  };

  private post(block: Float32Array): void {
    const node = this.target;
    // Nothing goes out once the edge is cut, the node is gone or the context closed.
    if (!node || node.disconnected || this.context?.closed) return;
    node.port.onmessage?.({ data: block });
  }

  private stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.target = null;
    this.carry = new Float32Array(0);
    void this.source.stop().catch(() => {});
  }
}

/** Stands in for the `AudioContext`; owns nothing but the wiring. */
class PushedContext {
  readonly sampleRate = REPORTED_SAMPLE_RATE;
  closed = false;
  readonly audioWorklet = { addModule: (_url: string): Promise<void> => Promise.resolve() };

  createMediaStreamSource(stream: PushedStream) {
    stream.context = this;
    return {
      connect: (node: PushedWorkletNode) => {
        stream.target = node;
      },
      disconnect: () => {
        stream.target = null;
      },
    };
  }

  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
}

/**
 * Session dependencies that capture from a pushed-PCM recorder.
 *
 * Each `openMicrophone` starts the recorder afresh, and stopping the stream's
 * track — which the session does on teardown, since it owns these resources —
 * stops the recorder.
 */
export function pushedCaptureDeps(source: PushedPcmSource): CaptureDeps {
  let current: PushedStream | null = null;
  let paused = false;
  const graph = {
    createAudioContext: () => new PushedContext(),
    createWorkletNode: () => new PushedWorkletNode(),
    openMicrophone: async () => {
      const stream = new PushedStream(source);
      stream.setPaused(paused);
      current = stream;
      await source.start(stream.accept);
      source.setPaused?.(paused);
      return stream;
    },
  };
  return {
    // The one cast: the session is typed against the DOM, and these classes are
    // the subset of it the session actually touches (see the file comment). The
    // pushed-capture spec runs the real session over them, so a member the
    // session starts to need fails there rather than on a device.
    ...(graph as unknown as Pick<
      ConversationSessionDeps,
      'createAudioContext' | 'createWorkletNode' | 'openMicrophone'
    >),
    workletUrl: '',
    ownsAudioResources: true,
    setPaused: (next) => {
      paused = next;
      current?.setPaused(next);
      source.setPaused?.(next);
    },
  };
}
