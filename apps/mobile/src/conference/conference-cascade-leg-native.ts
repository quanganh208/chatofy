/**
 * The meeting speaker's translation on React Native: the shared cascade leg
 * from `@chatofy/realtime-client`, fed by the native recorder.
 *
 * Everything that decides what is translated — turn-taking, the cascade over
 * `/ws/translate`, subtitle and audio relaying, reconnects, mute — lives in the
 * shared leg, so mobile runs exactly what web runs. This file only supplies the
 * platform: pushed native PCM for the microphone, the translate socket URL, and
 * the open conference socket the envelopes go out on.
 */

import {
  TranslateSocket,
  createConferenceCascadeLeg,
  pushedCaptureDeps,
  type ConferenceCascadeLeg,
  type ConferenceLegEndReason,
} from '@chatofy/realtime-client';
import type { LanguageCode } from '@chatofy/types/domain';
import type { NativeAudioCapture } from './native-audio-capture';
import { TRANSLATE_WS_URL } from './conference-config';
import { send } from './conference-signaling';

export interface NativeConferenceLegOptions {
  /** The open `/ws/conference` socket the translation is broadcast on. */
  confWs: WebSocket;
  /** The call's microphone. Owned by the call: it outlives this leg and releases the audio session on leave. */
  capture: NativeAudioCapture;
  /** Read afresh for every (re)built translate session, so a late rebuild never presents an expired token. */
  getToken: () => Promise<string>;
  sourceLanguage: LanguageCode;
  /** The languages the other participants speak; kept current via `setRoomLanguages`. */
  roomLanguages: Iterable<LanguageCode>;
  /** Drives the hook's `localTranslating` indicator. */
  onTranslatingChange: (translating: boolean) => void;
  /** Translation ended for good (not on a leave or stop asked for); the call goes on without it. */
  onEnded: (reason: ConferenceLegEndReason) => void;
  /** Start muted: applied before the first buffer is heard. */
  muted: boolean;
  /**
   * Whether a peer's translation is playing on this device right now. Required:
   * the leg's microphone hears the loudspeaker, and the platform echo canceller
   * does not keep a loud playback out of it, so that playback must not open a turn.
   */
  receivedSounding: () => boolean;
}

/**
 * Build (not start) a speaker leg. Voices are the schema defaults: mobile has no
 * translate settings screen to inherit them from.
 */
export function createNativeConferenceLeg(
  options: NativeConferenceLegOptions,
): ConferenceCascadeLeg {
  const { confWs, getToken } = options;
  const leg = createConferenceCascadeLeg({
    audioDeps: pushedCaptureDeps(options.capture),
    // `TRANSLATE_WS_URL` is a plain string: `translateSocketUrl` builds it with
    // `new URL()` setters, which React Native does not implement.
    createSocket: (handlers, token) => new TranslateSocket(TRANSLATE_WS_URL, handlers, token),
    // An empty token is no token: translation ends rather than retrying a refusal.
    getToken: async () => (await getToken()) || undefined,
    sendBroadcast: (envelope) => {
      if (confWs.readyState === WebSocket.OPEN) {
        send(confWs, 'conference.translation.broadcast', envelope);
      }
    },
    sourceLanguage: options.sourceLanguage,
    roomLanguages: options.roomLanguages,
    onTranslatingChange: options.onTranslatingChange,
    onEnded: options.onEnded,
    onLog: (message) => console.log(message),
    receivedSounding: options.receivedSounding,
  });
  if (options.muted) leg.pause();
  return leg;
}

/**
 * A user's leave: let the leg relay its in-flight turns' finals (bounded), THEN
 * close the room socket — closing first would drop the last sentence — and
 * only then release the call's microphone and audio session.
 */
export function drainLegThenClose(
  leg: ConferenceCascadeLeg | null,
  ws: WebSocket | null,
  capture: NativeAudioCapture | null,
): void {
  const release = (): void => {
    ws?.close();
    releaseCapture(capture);
  };
  if (!leg) {
    release();
    return;
  }
  leg
    .leave()
    .catch((err: unknown) => console.error('[conference] translation drain failed', err))
    .finally(release);
}

/** The call is over: stop the microphone and give the audio session back. */
export function releaseCapture(capture: NativeAudioCapture | null): void {
  capture
    ?.releaseSession()
    .catch((err: unknown) => console.error('[conference] audio session release failed', err));
}
