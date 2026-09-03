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
  /**
   * Whether closing this graph may also close the context and stop the stream.
   *
   * True for a caller that opened both for itself — a page that owns its own
   * microphone. FALSE for one handed an already-running graph, which is the
   * extension: there the context also carries the meeting's own passthrough and
   * the stream may be a captured tab, so closing either here would silence the
   * meeting and take the OTHER direction down with it. Same field, same meaning,
   * and the same reason as `ConversationSessionDeps.ownsAudioResources`.
   */
  ownsAudioResources?: boolean;
  /**
   * An optional denoise stage to splice between the microphone and capture.
   *
   * This is the one filtering allowed near this class, and only because it is a
   * TRANSFORM, not a gate: it emits the same number of samples it consumed, just
   * cleaned, so it withholds nothing and the "emits every block" contract below
   * holds unchanged. A gate — anything that drops quiet blocks — must never go
   * here; it would truncate the live translation exactly as the class comment
   * warns.
   *
   * Absent (the default) leaves the graph wired straight microphone → capture,
   * byte for byte as before, so a caller that says nothing is unaffected. Present,
   * the graph loads the extra worklet and wires microphone → denoise → capture.
   * The node itself is the caller's to build — its worklet carries the model, and
   * which model is a measured choice this class should not bake in.
   */
  denoise?: {
    workletUrl: string;
    createNode: (context: AudioContext) => AudioWorkletNode;
  };
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
  private denoiseNode: AudioWorkletNode | null = null;

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

    const source = context.createMediaStreamSource(stream);
    if (this.deps.denoise) {
      // microphone → denoise → capture. The denoise node is a transform, so the
      // capture worklet still receives every block; only the samples are cleaner.
      await context.audioWorklet.addModule(this.deps.denoise.workletUrl);
      const denoiseNode = this.deps.denoise.createNode(context);
      this.denoiseNode = denoiseNode;
      source.connect(denoiseNode);
      denoiseNode.connect(node);
    } else {
      source.connect(node);
    }
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
    // Only a graph that opened the stream may end it. Borrowed, the same tracks
    // are the meeting's captured tab or a microphone another direction is also
    // reading; stopping them is not undoable and takes that direction with it.
    // Dropping the handler above already stops this graph delivering blocks,
    // which is all `mute` promises.
    if (this.ownsResources) this.stream?.getTracks().forEach((track) => track.stop());
  }

  /** Release the microphone and the audio graph. Safe to call twice. */
  close(): void {
    this.mute();
    this.node?.disconnect();
    this.node = null;
    // The denoise node is this graph's own, built in open() even on a borrowed
    // context, so it is always released — leaving it attached would keep feeding
    // the capture worklet.
    this.denoiseNode?.disconnect();
    this.denoiseNode = null;
    this.stream = null;
    if (this.ownsResources) void this.context?.close();
    this.context = null;
  }

  /** Defaults to owning, so a caller that says nothing keeps the old behaviour. */
  private get ownsResources(): boolean {
    return this.deps.ownsAudioResources !== false;
  }
}
