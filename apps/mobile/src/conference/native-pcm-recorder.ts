/**
 * The meeting speaker's microphone as a raw Float32 source, written against the
 * few native calls it needs rather than the native module itself.
 *
 * `native-audio-capture.ts` binds it to react-native-audio-api; this half holds
 * the behaviour — mute at the source, one recorder per start, a clean failure —
 * and can be run under node, where the native module cannot load.
 *
 * Stopping it never ends the platform audio session. The shared leg stops and
 * restarts its recorder on every translate-socket rebuild while the call is
 * live, and react-native-webrtc holds that same session for the call's own
 * audio: ending it on a stop would cut or glitch the call on iOS each time
 * translation reconnects. The session is released once, by `releaseSession`,
 * when the call is left.
 */

import type { PushedPcmSource } from '@chatofy/realtime-client';

/**
 * The rate the shared session's block arithmetic assumes (the pushed-PCM shim
 * reports it). Asking the recorder for it spares the resampler when the device
 * honours the request; when it does not, the shim resamples and the log says so.
 */
const REQUESTED_SAMPLE_RATE = 48000;

/** A hint only: one session block (~21 ms at 48 kHz). The shim rechunks whatever arrives. */
const BUFFER_LENGTH_SAMPLES = 1024;

/** react-native-audio-api's onAudioReady buffer shape (standard Web Audio). */
interface RecorderBuffer {
  getChannelData(channel: number): Float32Array;
  sampleRate: number;
}
export interface OnAudioReadyEvent {
  buffer: RecorderBuffer;
  numFrames: number;
  when: number;
}

/** The recorder calls used, as react-native-audio-api's `AudioRecorder` offers them. */
export interface NativeRecorderHandle {
  onAudioReady(
    options: { sampleRate: number; bufferLength: number; channelCount: number },
    callback: (event: OnAudioReadyEvent) => void,
  ): unknown;
  clearOnAudioReady(): void;
  start(): Promise<unknown>;
  stop(): Promise<unknown>;
}

/** The platform calls a recorder needs. */
export interface NativeRecorderApi {
  /** iOS: a session category that lets capture coexist with the call. Android ignores it. */
  configureSession(): void;
  /** iOS: give the audio session back. Only {@link NativePcmRecorder.releaseSession} calls it. */
  deactivateSession(): Promise<void>;
  /** `'Granted'` when the app may record. */
  requestPermission(): Promise<string>;
  createRecorder(): NativeRecorderHandle;
  log?: (message: string) => void;
}

/**
 * Captures the device microphone for a meeting speaker's translation. One
 * recorder per `start()`; the shared session starts it when it opens the
 * microphone and stops it on teardown.
 */
export class NativePcmRecorder implements PushedPcmSource {
  private recorder: NativeRecorderHandle | null = null;
  private recording = false;
  private paused = false;
  /**
   * Every start and stop, run one after another in the order they were asked
   * for. A stop that lands while a start is opening then stops what it opened
   * rather than finding nothing yet, and a start asked for after that stop
   * opens a recorder of its own rather than joining one about to be stopped.
   */
  private queue: Promise<void> = Promise.resolve();
  // A plain field, not a parameter property: node runs this file's tests with
  // type stripping only, which cannot transform one.
  private readonly api: NativeRecorderApi;

  constructor(api: NativeRecorderApi) {
    this.api = api;
  }

  /**
   * Drop every buffer at the source while muted, before it reaches anything
   * that could transcribe it. The session pauses too; this is the second wall,
   * so a muted user is never transcribed or translated (privacy). The recorder
   * stays open, which keeps unmute instant (no re-acquire of the mic or the
   * audio session).
   */
  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  start(onBuffer: (samples: Float32Array, sampleRate: number) => void): Promise<void> {
    return this.serially(() => this.open(onBuffer));
  }

  /** Run `step` after every start and stop asked for before it; a failed one does not block the next. */
  private serially(step: () => Promise<void>): Promise<void> {
    const run = this.queue.then(step);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async open(onBuffer: (samples: Float32Array, sampleRate: number) => void): Promise<void> {
    if (this.recording) return;

    this.api.configureSession();
    const permission = await this.api.requestPermission();
    if (permission !== 'Granted') {
      throw new Error(`microphone permission not granted (${permission})`);
    }

    const recorder = this.api.createRecorder();
    this.recorder = recorder;
    let rateLogged = false;

    recorder.onAudioReady(
      {
        sampleRate: REQUESTED_SAMPLE_RATE,
        bufferLength: BUFFER_LENGTH_SAMPLES,
        channelCount: 1,
      },
      (event) => {
        if (!this.recording || this.paused || this.recorder !== recorder) return;
        // A buffer that reports no rate is taken at the requested one.
        const rate = event.buffer.sampleRate || REQUESTED_SAMPLE_RATE;
        if (!rateLogged && rate !== REQUESTED_SAMPLE_RATE) {
          rateLogged = true;
          this.api.log?.(
            `[capture] recorder delivers ${rate} Hz (asked ${REQUESTED_SAMPLE_RATE}); resampling`,
          );
        }
        onBuffer(event.buffer.getChannelData(0), rate);
      },
    );

    try {
      await recorder.start();
    } catch (err) {
      // Leave nothing half-open: a later start() must be able to try again.
      this.recorder = null;
      recorder.clearOnAudioReady();
      throw err;
    }
    this.recording = true;
  }

  /**
   * Stop this recorder only; the audio session stays as the call needs it. The
   * shared session calls this on every teardown, including a mid-call rebuild.
   */
  stop(): Promise<void> {
    return this.serially(() => this.close());
  }

  private async close(): Promise<void> {
    if (!this.recording) return;
    this.recording = false;
    const recorder = this.recorder;
    this.recorder = null;
    if (recorder) {
      recorder.clearOnAudioReady();
      await recorder.stop();
    }
  }

  /**
   * The call is over: stop recording and release the audio session, so a left
   * call leaves no microphone held. For the call's own teardown, never a
   * translation rebuild.
   */
  async releaseSession(): Promise<void> {
    await this.stop();
    await this.api.deactivateSession();
  }
}
