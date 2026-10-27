/**
 * Native mic capture as a raw Float32 source, built on react-native-audio-api's
 * `AudioRecorder` data-callback mode.
 *
 * It does no conversion: the buffers go to `pushedCaptureDeps` from
 * `@chatofy/realtime-client`, which resamples them to the 48 kHz it reports and
 * rechunks them into the 1024-sample blocks the shared `ConversationSession`
 * reads — so the turn-taking that runs on mobile is the one web runs. The
 * session encodes and sends; this only listens. The behaviour lives in
 * `native-pcm-recorder.ts`; this file binds it to the native module.
 *
 * ⚠️ Mic contention: react-native-webrtc already holds the microphone for the
 * published audio track during a call. Whether a second consumer (this recorder)
 * can open concurrently is device-dependent; it held on a Galaxy A13 (Android 14)
 * smoke test, where the call kept its audio while translation ran. The fallback,
 * if a device conflicts, is to tap the existing webrtc audio track instead of
 * opening a second mic.
 */

import { AudioManager, AudioRecorder as RNAudioRecorder } from 'react-native-audio-api';
import { NativePcmRecorder, type NativeRecorderApi } from './native-pcm-recorder';

const nativeRecorderApi: NativeRecorderApi = {
  // iOS: a playAndRecord/videoChat session so capture coexists with TTS
  // playback and the call audio. Android reads its permission from the
  // manifest (already declared) and ignores these.
  configureSession: () =>
    AudioManager.setAudioSessionOptions({
      iosCategory: 'playAndRecord',
      iosMode: 'videoChat',
      iosOptions: ['defaultToSpeaker', 'allowBluetoothHFP'],
    }),
  deactivateSession: () => AudioManager.setAudioSessionActivity(false),
  requestPermission: () => AudioManager.requestRecordingPermissions(),
  createRecorder: () => new RNAudioRecorder(),
  log: (message) => console.log(message),
};

/** The meeting speaker's microphone on this device; one per call. */
export class NativeAudioCapture extends NativePcmRecorder {
  constructor() {
    super(nativeRecorderApi);
  }
}
