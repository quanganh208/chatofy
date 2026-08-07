import { downsampleToPcm16, pcm16Rms } from './pcm-resampler.js';

/**
 * The browser pieces this graph needs, injected so a test can supply fakes.
 *
 * Named to match `ConversationSessionDeps` field for field. The two are wired
 * from the same place in an app and there is nothing gained by making a reader
 * check whether `openMicrophone` means the same thing in both.
 */
export interface MicrophoneGraphDeps {
  openMicrophone: () => Promise<MediaStream>;
  createAudioContext: () => AudioContext;
  createWorkletNode: (context: AudioContext) => AudioWorkletNode;
  workletUrl: string;
}

/**
 * A block of captured audio, already at the rate the backends take, and how
 * loud it was.
 *
 * The level is computed from the block in hand rather than from a second tap on
 * the graph: an `AnalyserNode` would measure the same samples again, at a
 * different moment, for a number that is only ever drawn on screen.
 */
export type MicrophoneBlockHandler = (block: Int16Array, rms: number) => void;

/**
 * Opens the microphone and emits every block it hears.
 *
 * **There is no gate here, and that is the entire point of the class.** The
 * turn-based path runs capture through `CapturePump`, which decides when someone
 * has started and stopped talking and withholds audio outside that window. The
 * live backend has no endpoint event — it learns an utterance ended from
 * trailing quiet — so withholding quiet blocks truncates the translation:
 * measured on a 3 s clip, cutting at the last speech sample returned
 * "However, the graft" and nothing more.
 *
 * So this class exists precisely so the live path can have a microphone without
 * inheriting a gate. Do not add filtering here, and do not "unify" it with
 * `CapturePump`.
 */
export class MicrophoneGraph {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;

  constructor(private readonly deps: MicrophoneGraphDeps) {}

  /**
   * Acquire the microphone and start delivering blocks.
   *
   * Rejects if the user denies the microphone or the worklet cannot load. The
   * caller is expected to `close()` on that path; doing it here would hide
   * which half failed from a caller that wants to say so.
   */
  async open(onBlock: MicrophoneBlockHandler): Promise<void> {
    const context = this.deps.createAudioContext();
    this.context = context;

    const stream = await this.deps.openMicrophone();
    this.stream = stream;

    await context.audioWorklet.addModule(this.deps.workletUrl);
    const node = this.deps.createWorkletNode(context);
    this.node = node;

    // Unconditional. A filter here would be the gate this path must not have.
    node.port.onmessage = (message: MessageEvent<Float32Array>) => {
      const block = downsampleToPcm16(message.data, context.sampleRate);
      onBlock(block, pcm16Rms(block));
    };

    context.createMediaStreamSource(stream).connect(node);
  }

  /**
   * Stop delivering blocks but leave the microphone open.
   *
   * The socket outlives the microphone on this path: translated audio trails the
   * speaker by seconds, so a caller that has stopped talking still wants what is
   * on its way back.
   */
  mute(): void {
    if (this.node) this.node.port.onmessage = null;
    this.stream?.getTracks().forEach((track) => track.stop());
  }

  /** Release the microphone and the audio graph. Safe to call twice. */
  close(): void {
    this.mute();
    this.node?.disconnect();
    this.node = null;
    this.stream = null;
    void this.context?.close();
    this.context = null;
  }
}
