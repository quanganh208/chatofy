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

import type { MicProcessing } from '@chatofy/types';
import { AudioManager, AudioRecorder as RNAudioRecorder } from 'react-native-audio-api';
import { NativePcmRecorder, type NativeRecorderApi } from './native-pcm-recorder';

/**
 * The platform cannot run echo cancellation, noise suppression and gain control
 * apart, so `echoCancellation` alone picks the chain; the settings keep the other
 * two equal to it.
 */
const nativeRecorderApi: NativeRecorderApi = {
  // iOS: a playAndRecord session so capture coexists with TTS playback and the
  // call audio. `videoChat` turns voice processing on for the whole session, so
  // with echo cancellation off the mode is `default`, or the switch would do
  // nothing on iOS. With no `android` entry Android keeps its audio mode (the
  // call's own), and reads the permission from the manifest (already declared).
  configureSession: (mic) =>
    AudioManager.setSystemOptions({
      ios: {
        category: 'playAndRecord',
        mode: mic.echoCancellation ? 'videoChat' : 'default',
        options: ['defaultToSpeaker', 'allowBluetoothHFP'],
      },
    }),
  deactivateSession: () => AudioManager.setAudioSessionActivity(false),
  requestPermission: () => AudioManager.requestRecordingPermissions(),
  // Android: VOICE_COMMUNICATION runs the platform echo canceller and noise
  // suppressor (the patch adds the session id it needs to attach);
  // VOICE_RECOGNITION is the raw capture path. iOS: the recorder's own
  // voice-processing I/O, matching the session mode above.
  createRecorder: (mic) =>
    new RNAudioRecorder({
      androidInputPreset: mic.echoCancellation ? 'voiceCommunication' : 'voiceRecognition',
      iosVoiceProcessing: mic.echoCancellation,
    }),
  log: (message) => console.log(message),
};

/**
 * The meeting speaker's or the translate tab's microphone on this device; one
 * per screen. `mic` is read at each start, so a changed setting applies at the
 * next session, never mid-session.
 */
export class NativeAudioCapture extends NativePcmRecorder {
  constructor(mic: () => MicProcessing) {
    super(nativeRecorderApi, mic);
  }
}
