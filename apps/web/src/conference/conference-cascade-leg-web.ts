/**
 * The meeting speaker's translation, wired to the browser.
 *
 * The leg itself — the /translate cascade, relayed into the room — is shared
 * with mobile (`createConferenceCascadeLeg`). What is browser-specific is only
 * where its microphone, audio graph and sockets come from, and how mute reaches
 * the track it captures.
 *
 * The leg captures a CLONE of the published microphone track. Each session the
 * leg builds stops the stream it was handed when it ends (its default
 * `ownsAudioResources`), and a session ends on every reconnect; handed the
 * original, the first of those would cut the participants off the speaker's
 * voice on the SFU too. A clone is one more consumer of the same device, not a
 * second device open.
 */
import {
  TranslateSocket,
  createConferenceCascadeLeg,
  type ConferenceCascadeLeg,
  type ConferenceLegEndReason,
} from '@chatofy/realtime-client';
import type { LanguageCode } from '@chatofy/types';
import { chosenVoices, loadTranslateSettings } from '@/lib/translate-settings';
import { send } from './conference-signaling';

/** Served from `public/worklets` (copied by `scripts/copy-worklets.mjs`); /translate loads the same file. */
const WORKLET_URL = '/worklets/mic-capture-processor.js';

export interface WebConferenceLegOptions {
  /** The OPEN `/ws/conference` socket broadcasts leave on. Never closed here. */
  ws: WebSocket;
  /** The published local media. Its tracks are never stopped here. */
  stream: MediaStream;
  sourceLanguage: LanguageCode;
  roomLanguages: Iterable<LanguageCode>;
  /** Full `ws(s)://…/ws/translate` endpoint. */
  translateSocketUrl: string;
  /** Resolves the CURRENT access token; read again for every session the leg builds. */
  getToken: () => Promise<string | undefined>;
  /** Applied before the first session, so a speaker who joined muted opens no turn. */
  muted: boolean;
  onTranslatingChange: (translating: boolean) => void;
  /** Translation ended for good (not on a leave or stop asked for); the call goes on without it. */
  onEnded?: (reason: ConferenceLegEndReason) => void;
  onLog?: (message: string) => void;
}

export interface WebConferenceLeg {
  start(): Promise<void>;
  /** Let in-flight turns finish (bounded), then stop. Close the room socket after it resolves. */
  leave(): Promise<void>;
  /** Hard stop: no final is relayed for an open turn. Idempotent. */
  stop(): void;
  /** Mute the microphone everywhere it goes: the published track, the leg's clone, the leg. */
  setMuted(muted: boolean): void;
  setRoomLanguages(languages: Iterable<LanguageCode>): void;
  noteRelayError(code: string): void;
}

export function createWebConferenceLeg(options: WebConferenceLegOptions): WebConferenceLeg {
  const { stream } = options;
  /** The track the current session captures; replaced on every rebuild. */
  let clone: MediaStreamTrack | null = null;
  const settings = loadTranslateSettings();

  const leg: ConferenceCascadeLeg = createConferenceCascadeLeg({
    audioDeps: {
      openMicrophone: () => {
        const original = stream.getAudioTracks()[0];
        if (!original) return Promise.reject(new Error('no microphone track to translate'));
        clone = original.clone();
        // A clone copies `enabled`, which is the published track's state rather
        // than the leg's; the leg's mute is the one this capture answers to.
        clone.enabled = !leg.muted;
        return Promise.resolve(new MediaStream([clone]));
      },
      createAudioContext: () => new AudioContext(),
      createWorkletNode: (context) => new AudioWorkletNode(context, 'mic-capture-processor'),
      workletUrl: WORKLET_URL,
    },
    createSocket: (handlers, token) =>
      new TranslateSocket(options.translateSocketUrl, handlers, token),
    getToken: options.getToken,
    sendBroadcast: (envelope) => send(options.ws, 'conference.translation.broadcast', envelope),
    sourceLanguage: options.sourceLanguage,
    roomLanguages: options.roomLanguages,
    // The /translate page's voice choices, so a speaker sounds the same in both.
    voice: {
      voiceGender: settings.voiceGender,
      speed: settings.speed,
      voices: chosenVoices(settings.voice),
    },
    // Also how a translation that ended for good clears the indicator: the leg
    // closes every open turn when its session goes, which reports `false` here.
    onTranslatingChange: options.onTranslatingChange,
    ...(options.onEnded ? { onEnded: options.onEnded } : {}),
    ...(options.onLog ? { onLog: options.onLog } : {}),
  });

  const setMuted = (muted: boolean): void => {
    stream.getAudioTracks().forEach((track) => (track.enabled = !muted));
    if (clone) clone.enabled = !muted;
    if (muted) leg.pause();
    else leg.resume();
  };

  if (options.muted) leg.pause();

  /** The session normally stops its clone; this covers a start cut short. Never the original. */
  const releaseClone = (): void => {
    clone?.stop();
    clone = null;
  };

  return {
    start: () => leg.start(),
    leave: async () => {
      try {
        await leg.leave();
      } finally {
        releaseClone();
      }
    },
    stop: () => {
      leg.stop();
      releaseClone();
    },
    setMuted,
    setRoomLanguages: (languages) => leg.setRoomLanguages(languages),
    noteRelayError: (code) => leg.noteRelayError(code),
  };
}
