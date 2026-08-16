import { echoCancellationAll } from '@chatofy/realtime-client';
import { DuckController } from './duck-controller';
import { MICROPHONE_BLOCKED } from './microphone-permission';

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

/**
 * Why this microphone asks for `"all"` rather than plain `true`.
 *
 * It is what replaces the echo gate for a backend whose playback has no gaps
 * (`microphone-gate.ts`). Plain `echoCancellation` does not reach the loop
 * described above — the reason, and the trap in how the constraint is written,
 * are recorded once on `ECHO_CANCELLATION_ALL` in `@chatofy/realtime-client`.
 *
 * Deliberately NOT applied to `EchoMonitor`'s microphone. That one stands in for
 * what a meeting client hears, and cancelling our playout out of the measurement
 * would leave it measuring nothing.
 */

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
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: echoCancellationAll,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } catch (err) {
    // A `NotAllowedError` from this document is never someone clicking Block: this
    // is the offscreen document, it has no window, and Chrome refuses the call
    // outright rather than asking. It means the extension origin has no grant, and
    // the message has to name the one place that can give it — Chrome's own
    // wording ("Permission denied") points at a prompt nobody was shown.
    if (err instanceof DOMException && err.name === 'NotAllowedError') {
      throw new Error(MICROPHONE_BLOCKED, { cause: err });
    }
    throw err;
  }

  // What was ASKED for is in the code above; what was GRANTED is only here. The
  // echo measurement is read against this line, so a run where the string was
  // coerced back to a plain `true` has to be distinguishable from one where it
  // took. `true` therefore prints as `true`, not as a success.
  const applied = stream.getAudioTracks()[0]?.getSettings();
  console.info(
    `[chatofy] outbound microphone: echoCancellation=${String(applied?.echoCancellation ?? 'unreported')}`,
  );

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
