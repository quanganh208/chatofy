/**
 * One translate conversation on the phone: the shared session from
 * `@chatofy/realtime-client` (the same turn-taking, cascade and `/ws/translate`
 * contract web runs) fed by the native microphone and speaking through the
 * phone's speaker.
 *
 * What it adds on top of the session is only the platform: mic + permission,
 * the access token, the microphone lock shared with meetings, and turning the
 * session's events into state a screen can render. It does not group, label or
 * save turns — see `save-conversation.ts` for the save.
 */

import { useCallback, useEffect, useReducer, useState } from 'react';
import type { MessageKey } from '@chatofy/i18n';
import {
  CASCADE_RUNTIME_OPTIONS,
  CASCADE_STREAM_COMMITTED,
  ConversationSession,
  TranslateSocket,
  initialTurnKeyedTranscript,
  liveTurnsInOrder,
  pushedCaptureDeps,
  turnKeyedTranscriptReducer,
  type ConversationStatus,
  type LiveTurn,
  type PauseInterval,
  type TurnKeyedTranscript,
} from '@chatofy/realtime-client';
import type { SessionLanguageMode, SessionLanguagePair, SessionOptions } from '@chatofy/types';
import { authClient } from '@/clients/auth-client';
import { NativeAudioCapture } from '@/conference/native-audio-capture';
import { TRANSLATE_WS_URL } from '@/conference/conference-config';
import { micLock } from './mic-lock';
import { NativeTranslateAudioSink } from './native-translate-audio-sink';
import { asksTwoWay } from './translate-mode';
import { startFailureKey } from './translate-refusal';
import type { TranslateSettings } from './translate-settings';

/** What went wrong, as a catalogue key where the app has the words, else the server's text. */
export type TranslateError = { key: MessageKey } | { text: string };

/** Which conversation is on screen: stamped once at start, read by the save. */
export interface ConversationIdentity {
  id: string;
  startedAt: string;
  pair: SessionLanguagePair;
  /** What was ASKED for; the server's answer is `languageMode`. */
  askedTwoWay: boolean;
}

export interface LanguageModeAnswer {
  mode: SessionLanguageMode;
  reason?: string;
}

const NO_PAUSES: readonly PauseInterval[] = [];

/** Values the session's callbacks read when they run, long after the render that built them. */
class SessionEnv {
  token = '';
  sink: NativeTranslateAudioSink | null = null;
  /** Bumped by every stop, so a start still waiting for its token can tell it was left. */
  stops = 0;

  setToken(token: string): void {
    this.token = token;
  }

  setSink(sink: NativeTranslateAudioSink | null): void {
    this.sink = sink;
  }

  noteStop(): void {
    this.stops += 1;
  }
}

export interface UseTranslateConversation {
  status: ConversationStatus;
  /** The reducer's state: finished turns, their captures and display text. */
  conversation: TurnKeyedTranscript;
  liveTurns: (LiveTurn & { sessionId: string })[];
  /** Microphone level, 0..1. */
  level: number;
  error: TranslateError | null;
  languageMode: LanguageModeAnswer | null;
  identity: ConversationIdentity | null;
  pauses: readonly PauseInterval[];
  start: (settings: TranslateSettings) => Promise<void>;
  /** Stops now. Turns still being translated are lost. */
  stop: () => void;
  /** Lets turns in flight finish and be spoken, then stops. */
  end: () => void;
  pause: () => void;
  resume: () => void;
}

export function useTranslateConversation(): UseTranslateConversation {
  const [status, setStatus] = useState<ConversationStatus>('idle');
  const [conversation, dispatch] = useReducer(
    turnKeyedTranscriptReducer,
    initialTurnKeyedTranscript,
  );
  const [error, setError] = useState<TranslateError | null>(null);
  const [level, setLevel] = useState(0);
  const [languageMode, setLanguageMode] = useState<LanguageModeAnswer | null>(null);
  const [identity, setIdentity] = useState<ConversationIdentity | null>(null);
  const [pauses, setPauses] = useState<readonly PauseInterval[]>(NO_PAUSES);

  // What the session's callbacks read at call time, held in one mutable object that
  // lives as long as the screen: the access token for the next socket, and the
  // sink currently speaking. A holder rather than refs, because the session is
  // built once in an initializer and its callbacks run long after render.
  const [live] = useState(() => new SessionEnv());

  // One recorder and one session for the life of the screen; both are rebuilt
  // never, because the session starts and tears down its own resources per run.
  const [capture] = useState(() => new NativeAudioCapture());
  const [session] = useState(
    () =>
      new ConversationSession(
        {
          ...pushedCaptureDeps(capture),
          // The token is read when the run starts (`start` below), a moment before the
          // socket opens, so it has at least the refresh skew left at the handshake.
          createSocket: (handlers) => new TranslateSocket(TRANSLATE_WS_URL, handlers, live.token),
          // The session's own "context" is the pushed-capture shim, which cannot play
          // anything; translations go to the phone's speaker through a native sink.
          createPlaybackSink: (_context, onTurnDrained) => {
            const sink = new NativeTranslateAudioSink(onTurnDrained);
            live.setSink(sink);
            return sink;
          },
        },
        {
          onStatus: setStatus,
          onLevel: setLevel,
          onMuted: () => {},
          onError: (message, cause) => {
            if (message === null) {
              setError(null);
              return;
            }
            const key = startFailureKey(message, cause);
            setError(key ? { key } : { text: message });
          },
          onLanguageMode: (mode, reason) =>
            setLanguageMode(reason === undefined ? { mode } : { mode, reason }),
          onEchoHeard: () => {},
          onServerEvent: dispatch,
          onReset: () => dispatch({ type: 'transcript.reset' }),
          onPauses: setPauses,
          onTurnAbandoned: (sessionId, reason) =>
            dispatch({
              type: 'transcript.turnAbandoned',
              sessionId: sessionId ?? undefined,
              reason,
            }),
          onTurnCaptured: ({ sessionId, cutForced, openedAt, closedAt, preRollMs }) =>
            dispatch({
              type: 'transcript.turnCaptureRecorded',
              sessionId,
              cutForced,
              openedAt,
              closedAt,
              preRollMs,
            }),
          // The last moment to give everything back: the transcript's unplaced turns,
          // the microphone owner, and the iOS audio session. The session also lands
          // here when stopped idle, which every blur of this tab does; the audio
          // session is shared with a meeting, so only the lock's holder lets it go.
          onStopped: () => {
            live.setSink(null);
            dispatch({ type: 'transcript.settled' });
            if (!micLock.release('translate')) return;
            capture
              .releaseSession()
              .catch((err: unknown) =>
                console.warn('[translate] audio session release failed', err),
              );
          },
          onLog: (message) => console.log(`[translate] ${message}`),
        },
        // The phone's loudspeaker is next to its microphone: while a translation is
        // sounding it must not open a turn of its own, whatever the echo canceller lets by.
        () => ({
          ...CASCADE_RUNTIME_OPTIONS,
          receivedSounding: () => live.sink?.isPlaying ?? false,
        }),
      ),
  );

  const start = useCallback(
    async (settings: TranslateSettings) => {
      if (session.isRunning) return;
      if (!micLock.acquire('translate')) {
        setError({ key: 'mobile.translate.micInUse' });
        return;
      }
      const stopsBefore = live.stops;
      try {
        live.setToken(await authClient.getAccessToken());
      } catch {
        micLock.release('translate');
        setError({ key: 'mobile.conference.notAuthenticated' });
        return;
      }
      // Left while the token was on its way: the session never saw this start, so
      // its own guard cannot catch it and the microphone would open off screen.
      if (live.stops !== stopsBefore) return;

      const { pair } = settings;
      const askedTwoWay = asksTwoWay(pair);
      // Before `session.start`, which dispatches the reset: the id and the
      // transcript it names must change together.
      setIdentity({
        id: globalThis.crypto.randomUUID(),
        startedAt: new Date().toISOString(),
        pair,
        askedTwoWay,
      });
      setLanguageMode(null);

      const options: SessionOptions = {
        languagePair: pair,
        ...(askedTwoWay ? { twoWay: true } : {}),
        voiceGender: settings.voiceGender,
        voiceOutput: settings.speak,
        ...(Object.keys(settings.voices).length > 0 ? { voices: settings.voices } : {}),
        streamCommitted: CASCADE_STREAM_COMMITTED,
        repairDisplay: true,
      };
      await session.start(options);
      // A start abandoned part-way has no run to stop, so the lock is freed here
      // when nothing is running.
      if (!session.isRunning) micLock.release('translate');
    },
    [session, live],
  );

  const stop = useCallback(() => {
    live.noteStop();
    session.stop();
  }, [session, live]);
  const end = useCallback(() => session.finish(), [session]);
  const pause = useCallback(() => session.pause(), [session]);
  const resume = useCallback(() => session.resume(), [session]);

  // Unmounting ends the conversation, so the microphone cannot outlive the screen.
  // Sending the app to the background does not unmount it.
  useEffect(() => stop, [stop]);

  return {
    status,
    conversation,
    liveTurns: liveTurnsInOrder(conversation),
    level,
    error,
    languageMode,
    identity,
    pauses,
    start,
    stop,
    end,
    pause,
    resume,
  };
}
