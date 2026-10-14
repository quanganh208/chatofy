/**
 * Native mic capture → 16 kHz mono PCM16 frames, the React Native parallel of
 * web's `AudioContext` + `ScriptProcessor` capture in `use-conference.ts`
 * (`wireTranslate`). Built on react-native-audio-api's `AudioRecorder`
 * data-callback mode.
 *
 * react-native-audio-api hands back `Float32Array` channel data in the range
 * [-1, 1] (exactly what web's `getChannelData(0)` returns), so the PCM16
 * conversion reuses `downsampleToPcm16` / `pcm16ToBase64` from
 * `@chatofy/realtime-client` rather than hand-rolling it. We request a 16 kHz
 * capture, but the device may honour a different rate; the adapter downsamples
 * from the buffer's ACTUAL rate so the /ws/translate wire is always 16 kHz.
 *
 * Implements the repo's `AudioRecorder` contract
 * (src/audio/audio-recorder.interface.ts): `start(onFrame)`, `stop()`,
 * `isRecording`, where `onFrame(chunk: Uint8Array, sequence)` carries one
 * PCM16-LE block.
 *
 * ⚠️ Mic contention: react-native-webrtc already holds the microphone for the
 * mediasoup audio track during a call. Whether a second consumer (this recorder)
 * can open concurrently is device-dependent and UNVERIFIED on hardware — see the
 * Phase 2 report's runtime-verification section. The fallback, if it conflicts,
 * is to tap the existing webrtc audio track instead of opening a second mic.
 */

import { AudioManager, AudioRecorder as RNAudioRecorder } from 'react-native-audio-api';
import { downsampleToPcm16, pcm16ToBase64 } from '@chatofy/realtime-client';
import type { AudioRecorder, AudioFrameCallback } from '../audio/audio-recorder.interface';

/**
 * Rate the STT models are trained at and the /ws/translate wire expects.
 * Matches realtime-client's own `TARGET_SAMPLE_RATE` (not re-exported from its
 * package index, so pinned here to the same value).
 */
const TARGET_SAMPLE_RATE = 16000;

/** ~100 ms of 16 kHz audio per callback — matches the doc's recommended chunk. */
const BUFFER_LENGTH_SAMPLES = 1600;

/** react-native-audio-api's onAudioReady buffer shape (standard Web Audio). */
interface RecorderBuffer {
  getChannelData(channel: number): Float32Array;
  sampleRate: number;
}
interface OnAudioReadyEvent {
  buffer: RecorderBuffer;
  numFrames: number;
  when: number;
}

/**
 * Captures the device microphone as 16 kHz mono PCM16 frames for the translate
 * bridge. One instance per call; `start()` on join, `stop()` on leave.
 */
export class NativeAudioCapture implements AudioRecorder {
  private recorder: RNAudioRecorder | null = null;
  private recording = false;
  private sequence = 0;

  get isRecording(): boolean {
    return this.recording;
  }

  async start(onFrame: AudioFrameCallback): Promise<void> {
    if (this.recording) return;

    // iOS: a playAndRecord/videoChat session so capture coexists with TTS
    // playback and the call audio. Android reads its permission from the
    // manifest (already declared) and ignores these.
    AudioManager.setAudioSessionOptions({
      iosCategory: 'playAndRecord',
      iosMode: 'videoChat',
      iosOptions: ['defaultToSpeaker', 'allowBluetoothHFP'],
    });

    const permission = await AudioManager.requestRecordingPermissions();
    if (permission !== 'Granted') {
      throw new Error(`microphone permission not granted (${permission})`);
    }

    const recorder = new RNAudioRecorder();
    this.recorder = recorder;
    this.sequence = 0;

    recorder.onAudioReady(
      {
        sampleRate: TARGET_SAMPLE_RATE,
        bufferLength: BUFFER_LENGTH_SAMPLES,
        channelCount: 1,
      },
      (event: OnAudioReadyEvent) => {
        if (!this.recording) return;
        const float32 = event.buffer.getChannelData(0);
        // Downsample from the buffer's ACTUAL rate (may differ from requested),
        // falling back to 16 kHz when the buffer reports no rate. When already
        // at 16 kHz this is a straight float→int16 quantise (ratio 1:1).
        const inputRate = event.buffer.sampleRate || TARGET_SAMPLE_RATE;
        const pcm16 = downsampleToPcm16(float32, inputRate, TARGET_SAMPLE_RATE);
        if (pcm16.length === 0) return;
        const bytes = new Uint8Array(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength);
        onFrame(bytes, this.sequence++);
      },
    );

    await recorder.start();
    this.recording = true;
  }

  async stop(): Promise<void> {
    if (!this.recording) return;
    this.recording = false;
    const recorder = this.recorder;
    this.recorder = null;
    if (recorder) {
      recorder.clearOnAudioReady();
      await recorder.stop();
    }
    // Release the iOS audio session so a left call leaves no mic held.
    void AudioManager.setAudioSessionActivity(false);
  }
}

/**
 * Convenience: base64-encode a PCM16 byte chunk for the /ws/translate wire. The
 * bridge needs base64; capture emits bytes so the interface stays codec-neutral.
 */
export function pcm16BytesToBase64(bytes: Uint8Array): string {
  const samples = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
  return pcm16ToBase64(samples);
}
