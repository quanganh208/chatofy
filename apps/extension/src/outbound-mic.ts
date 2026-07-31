import { DuckController } from './duck-controller';

/**
 * The user's microphone, with a gate that can silence it completely.
 *
 * This is the input to the OUTBOUND direction — the one that translates what the
 * user says. It is a second, separate `getUserMedia` from the one `EchoMonitor`
 * holds, because the two want different things from the same device: that one
 * measures how much of our own playback comes back and must never be gated, this
 * one feeds a translator and must be.
 *
 * The gate exists because half of the echo problem survives into this direction.
 * On a loudspeaker the microphone hears the INBOUND translation playing, the
 * speech gate downstream opens a turn on it, and the extension translates its own
 * output back into the meeting. That is the loop the offscreen architecture
 * removed from the inbound path by construction; it does not disappear here, it
 * moves.
 *
 * Gating at the source rather than inside `CapturePump` is not a shortcut. The
 * pump's own suppression hangs off its `awaiting-result` state, which continuous
 * mode never enters, so there is no way to reach it from outside. Feeding it
 * silence is what a mute actually looks like from where the pump sits: the speech
 * gate sees nothing above its floor and never opens a turn.
 */

/** Silence, not a duck. Anything above zero can still confirm as speech. */
const GATED_GAIN = 0;

export interface GatedMicrophone {
  /** What the outbound session captures. Not the raw device — the gated copy. */
  readonly stream: MediaStream;
  /** Silence the microphone, or let it through again after the ramp's release. */
  setSuppressed(suppressed: boolean): void;
  stop(): void;
}

/**
 * Open the microphone and put a gate in front of the translator.
 *
 * Opened with the browser's own cleanup ON, for the same reason the echo
 * microphone is: this is the configuration a meeting client uses, so measuring
 * or translating with it off would describe a setup nobody runs.
 */
export async function openGatedMicrophone(context: AudioContext): Promise<GatedMicrophone> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  const source = context.createMediaStreamSource(stream);
  const destination = context.createMediaStreamDestination();
  const gate = new DuckController(context, GATED_GAIN);
  gate.connect(source, destination);

  return {
    stream: destination.stream,
    setSuppressed: (suppressed) => gate.setBusy(suppressed),
    stop: () => {
      gate.release();
      gate.disconnect();
      source.disconnect();
      // The device itself, which the destination node's stream is not: stopping
      // only the gated copy leaves the microphone open with Chrome's recording
      // indicator lit.
      stream.getTracks().forEach((track) => track.stop());
    },
  };
}
