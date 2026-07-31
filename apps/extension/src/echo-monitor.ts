import { openEchoMicrophone } from './tab-audio-source';

/**
 * Counts how much of our own translated speech comes back through the microphone.
 *
 * This is the measurement that decides whether the feature is usable on a
 * loudspeaker, and it exists because half of the echo problem does NOT go away in an
 * extension.
 *
 * The half that does: translated audio plays from the offscreen document, which is
 * not in the captured tab's audio graph, so it cannot be re-captured and
 * re-translated. That loop is gone by construction rather than by muting, which is
 * what makes continuous capture possible at all.
 *
 * The half that does not: the user's microphone is still open and the meeting client
 * is still transmitting it. Meet's echo canceller takes its reference from Meet's
 * own output inside the tab, and this offscreen document is a different output that
 * reference knows nothing about. So on a loudspeaker the Vietnamese translation
 * reaches everyone in the meeting, and there is a second-order path — their speaker
 * plays it, their microphone hears it, it arrives back in this tab and is translated
 * again.
 *
 * None of that is fixable from an extension. What is possible is to MEASURE it, so
 * the constraint can be stated with a number beside it instead of as a worry.
 *
 * Deliberately NOT wired to a length ceiling: given one, the gate underneath would
 * fire on the clock rather than on echo and the count would be meaningless.
 */

export interface EchoMonitorDeps {
  /** The same context the playback graph uses — see the note in {@link start}. */
  context: AudioContext;
  workletUrl: string;
  /** Whether translated audio is being spoken right now. */
  isPlaying: () => boolean;
  onEchoHeard: () => void;
}

/**
 * A microphone listening only for our own voice coming back.
 *
 * Counts an event when speech is heard WHILE playback is sounding. Outside playback
 * the microphone hears the actual room, which is not echo and is not this
 * measurement's business.
 */
export class EchoMonitor {
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private events = 0;

  constructor(private readonly deps: EchoMonitorDeps) {}

  get echoEvents(): number {
    return this.events;
  }

  /**
   * Open the microphone and start counting.
   *
   * Uses the caller's `AudioContext` rather than making its own, and that is not an
   * optimisation. `ConversationSession` owns that context and closes it on teardown;
   * a second context here would outlive it, holding the microphone open with its
   * indicator lit after the user pressed stop.
   *
   * Failure is swallowed. A refused microphone means the echo measurement is
   * unavailable, which is a lost number, not a lost feature — the translation itself
   * never touches this stream.
   */
  async start(): Promise<void> {
    try {
      this.stream = await openEchoMicrophone();
      await this.deps.context.audioWorklet.addModule(this.deps.workletUrl);

      const node = new AudioWorkletNode(this.deps.context, 'mic-capture-processor');
      this.node = node;
      this.source = this.deps.context.createMediaStreamSource(this.stream);
      this.source.connect(node);
      // Not connected to the destination: this microphone must never be audible.
      // A worklet still runs without a downstream connection because it posts its
      // blocks to the main thread rather than returning them.

      node.port.onmessage = (message: MessageEvent<Float32Array>) => {
        if (!this.deps.isPlaying()) return;
        if (isSpeech(message.data)) {
          this.events += 1;
          this.deps.onEchoHeard();
        }
      };
    } catch {
      // Leaves `echoEvents` at 0, which the report must distinguish from a genuine
      // zero — hence the runbook's instruction to record whether the microphone was
      // granted.
      this.stop();
    }
  }

  stop(): void {
    if (this.node) this.node.port.onmessage = null;
    this.source?.disconnect();
    this.node?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.node = null;
    this.source = null;
  }
}

/**
 * Level above which a block counts as our own voice returning.
 *
 * A fixed threshold, not the adaptive floor `SpeechGate` uses. The gate's floor
 * learns the room so it can catch quiet speech; here the room is exactly what has to
 * be ignored, and a floor that adapted to a loudspeaker playing into it would learn
 * to treat the echo as background and stop counting it.
 *
 * -34 dBFS is well above conversational room tone and below the level a loudspeaker
 * returns at any usable volume.
 */
const ECHO_THRESHOLD = 0.02;

function isSpeech(block: Float32Array): boolean {
  let sum = 0;
  for (let i = 0; i < block.length; i += 1) sum += block[i]! * block[i]!;
  return Math.sqrt(sum / block.length) > ECHO_THRESHOLD;
}
