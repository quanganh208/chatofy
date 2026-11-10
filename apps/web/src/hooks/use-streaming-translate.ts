'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { DEFAULT_MIC_PROCESSING } from '@chatofy/types';
import type {
  LanguageCode,
  MicProcessing,
  SessionLanguageMode,
  SessionLanguagePair,
  SessionOptions,
  TranscriptSegment,
} from '@chatofy/types';
import {
  CASCADE_STREAM_COMMITTED,
  cascadeRuntimeFor,
  ConversationSession,
  PcmPlaybackQueue,
  TranslateSocket,
  translateSocketUrl,
  initialTurnKeyedTranscript,
  liveTurnsInOrder,
  turnKeyedTranscriptReducer,
  attributionStats,
  blocksToRetranslate,
  groupTurnsForDisplay,
  type AttributionsBySession,
  type BlockTranslation,
  type AttributionStats,
  type CapturesBySession,
  type UnheardBySession,
  type ConversationStatus,
  type LiveTurn,
  type PauseInterval,
  type ServerErrorCause,
  type SessionSpeaker,
} from '@chatofy/realtime-client';
import { useAccessToken } from '@/hooks/use-access-token';
import { useAuthRecovery } from '@/hooks/use-auth-recovery';
import {
  useConversationRecording,
  type ConversationRecording,
} from '@/hooks/use-conversation-recording';
import { useLocale, useTranslate } from '@/i18n/provider';
import { formatCreditSeconds } from '@/lib/credit-format';
import { openMicrophone } from '@/lib/open-microphone';
import { asksTwoWay, type ConversationMode } from '@/lib/translate-settings';
import { env } from '@/config/env';
import type { Locale, Translate } from '@chatofy/i18n';
import type { ServerEvent } from '@chatofy/types';

/**
 * What a caller starts a conversation with. `twoWay` is not among it: whether
 * to ask for it follows from the pair and the page's mode (`asksTwoWay`), so
 * one rule decides it for every start rather than each caller deciding again.
 */
export type StartOptions = Omit<SessionOptions, 'twoWay'> & {
  /** The page's mode — `/translate/one-way` or `/translate/two-way`; `asksTwoWay` turns it into the request. */
  mode: ConversationMode;
};

/** What the server said about the languages of the newest turn. */
interface LanguageModeAnswer {
  mode: SessionLanguageMode;
  /** Why `mode` is less than was asked for; absent when it is not. */
  reason?: string;
}

/** The credit codes a `server.error` can carry; the realtime client stops on the last two. */
const CREDIT_CODES: ReadonlySet<string> = new Set([
  'credits_low',
  'credits_exhausted',
  'credits_unavailable',
]);

/**
 * Whether the newest credit `server.error` answered one turn's start. The
 * balance it carried arrives on `onError`'s cause; the turn id does not, so the
 * hook reads it as the event passes through `onServerEvent` — which the session
 * calls first, for every event.
 */
interface CreditEvent {
  /** Present when the refusal answered one turn's start rather than ending the run. */
  turnId: string | undefined;
}

/**
 * A refusal said in the reader's language, where its code is one this page
 * knows; null hands the server's own message through.
 *
 * `language_unavailable` with a `detail` is named: it is the answer to an
 * "Auto-detect" start, and the server's English names the mechanism where the
 * reader needs the next step.
 *
 * The credit codes are named too. `credits_exhausted` says two different
 * things: carrying a `turnId` it refused a start (under one credit), and
 * without one the balance ran out mid-conversation — so the copy follows the
 * turn id.
 */
function refusalMessage(
  t: Translate,
  locale: Locale,
  cause: ServerErrorCause | undefined,
  credit: CreditEvent | null = null,
): string | null {
  if (cause?.code === 'credits_low') {
    return t('common.billing.low', {
      credits: formatCreditSeconds(t, locale, cause.remainingCreditSeconds ?? 0),
    });
  }
  if (cause?.code === 'credits_exhausted') {
    return credit?.turnId ? t('common.billing.startRefused') : t('common.billing.exhausted');
  }
  if (cause?.code === 'credits_unavailable') return t('common.billing.unavailable');
  if (cause?.code !== 'language_unavailable') return null;
  if (cause.detail === 'language_detection') return t('web.translate.detectUnavailable');
  if (cause.detail === 'lid_capacity') return t('web.translate.detectBusy');
  return null;
}

const WORKLET_URL = '/worklets/mic-capture-processor.js';

/** No pauses, with one identity, so a memo keyed on it does not re-run. */
const NO_PAUSES: readonly PauseInterval[] = [];

/**
 * Playback gain never exceeds unity.
 *
 * Above 1 the samples clip, and it raises the loudspeaker level feeding the
 * microphone — which is the loop full duplex (`CASCADE_RUNTIME_OPTIONS`)
 * deliberately accepts the risk of. Boosting is not worth making that loop more likely to close.
 */
const clampVolume = (volume: number): number => Math.min(1, Math.max(0, volume));

const MIC_PROCESSORS = ['echoCancellation', 'noiseSuppression', 'autoGainControl'] as const;

/**
 * Logs each processor the browser applied differently from what was asked.
 *
 * Only a boolean the browser reports counts: one that reports nothing has not
 * said it disagrees, and a warning for it would be noise on every start.
 */
function warnIfNotApplied(stream: MediaStream, asked: MicProcessing): void {
  const applied = stream.getAudioTracks()[0]?.getSettings();
  for (const key of MIC_PROCESSORS) {
    const value = applied?.[key];
    if (typeof value === 'boolean' && value !== asked[key]) {
      console.warn(`[chatofy] mic: browser applied ${key}=${value}, asked ${asked[key]}`);
    }
  }
}

export interface UseStreamingTranslate {
  status: ConversationStatus;
  /** Finished turns, newest last. */
  turns: TranscriptSegment[];
  /**
   * What the speaker is saying right now, as far as the recogniser has heard.
   * Empty between turns.
   *
   * One entry per turn still being spoken. A list rather than a single line
   * because capture no longer waits: with several turns in flight, one live line
   * for the conversation is overwritten by whichever turn's partial arrived last,
   * so the text flickers between two sentences and the first turn to finish wipes
   * a line someone is still speaking.
   */
  liveTurns: (LiveTurn & { sessionId: string })[];
  /**
   * Who is in this conversation, and who said each finished turn.
   *
   * Both come from the same reducer the transcript does, and they leave with it
   * — the session's own unmount cleanup is the whole of the guarantee that no
   * voice label outlives the conversation. A component that kept its own copy
   * in `useState` would be a second source of truth for what is on screen, and
   * the one that survived would be the wrong one.
   */
  speakers: SessionSpeaker[];
  attributions: AttributionsBySession;
  /**
   * What capture measured about each finished turn, keyed by `sessionId`.
   *
   * The transcript joins this to the turns at render time so one utterance the
   * length ceiling split into several turns reads as one block.
   */
  captures: CapturesBySession;
  /**
   * Turns whose translation was never spoken — dropped from the playback queue
   * or released by the stall watchdog. The transcript marks them.
   */
  unheard: UnheardBySession;
  /** Repaired source text per turn, where a repair exists. Falls back to raw. */
  displays: Record<string, string>;
  /** Whole-block translations of merged forced-cut pieces, keyed by `blockKey` — every segment id of the shape, joined. */
  blockTranslations: Record<string, BlockTranslation>;
  /** How the labelling went, for reading back after a conversation. */
  stats: AttributionStats;
  /** Add a participant. Without a label they get a numbered one in the reader's language. */
  addSpeaker: (label?: string) => void;
  renameSpeaker: (speakerId: string, label: string) => void;
  /** Refused while the speaker has turns; see `canRemoveSpeaker`. */
  removeSpeaker: (speakerId: string) => void;
  attributeTurn: (sessionId: string, speakerId: string) => void;
  /** Say that none of the named people spoke this turn. */
  unattributeTurn: (sessionId: string) => void;
  /**
   * Times speech was confirmed while our own translation was playing.
   *
   * The only trace an acoustic loop leaves, and the reason the build-time
   * full-duplex flag could be removed — but it is NOT a count of echo, and this
   * page must not present it as one. The microphone is honoured throughout
   * playback here, so someone talking over the translation confirms this gate
   * exactly as our own loudspeaker would; barge-in is the feature, not a fault,
   * and nothing at this level separates the two. Room noise lands here as well.
   *
   * So: non-zero means "something was said while our audio was out", and what
   * settles which is the transcript — an acoustic loop fills it with the app's
   * own voice, unmistakably. Read `CapturePumpHandlers.onEchoHeard` in
   * `@chatofy/realtime-client` before quoting this number in a measurement.
   */
  echoHeard: number;
  /**
   * The pump is ignoring the microphone because our translation is audible. Only
   * ever true in half duplex, which is to say with echo cancellation off — see
   * `cascadeRuntimeFor`.
   */
  micPaused: boolean;
  error: string | null;
  /**
   * A notice that stops nothing: today only "credits are running low". Kept
   * apart from `error` because an error is drawn as a failure and gates the
   * readiness banner, and the conversation this notice is about keeps going.
   * Cleared on the next start and by any credit stop that follows it.
   */
  notice: string | null;
  /** Live microphone level (0..1) for a meter. */
  level: number;
  /**
   * The id of the conversation in progress, or of the one that just finished.
   * Null until the first `start`.
   *
   * Minted inside `start`, NOT once per mount. The conversation boundary is not
   * the mount: `start` fires `onReset`, which clears the transcript, so a second
   * conversation without a fresh id would `PUT` over the first — deleting it with
   * no error and no signal. A dropped socket makes the session stop itself, so
   * resuming after a network blip is exactly that case.
   */
  conversationId: string | null;
  /** ISO-8601 instant the current conversation started. Minted with the id. */
  startedAt: string | null;
  /**
   * The language pair this conversation was actually started with. Minted with
   * the id and never re-read from settings afterwards, because settings can change
   * the moment the microphone stops — the language pickers are only disabled
   * while `running`. A pane or a save that read `settings.languagePair` instead
   * would show or store turns under languages they were never spoken in the
   * moment somebody swapped it. Null until the first `start`.
   */
  languagePair: SessionLanguagePair | null;
  /**
   * Whether this conversation's start asked the server for two-way. Stamped
   * with the pair, so a banner comparing it with {@link languageMode} compares
   * two facts about the same conversation.
   */
  twoWayRequested: boolean;
  /**
   * How the server ran the newest turn's languages, or null before any turn of
   * this conversation opened. What the screen's two-way affordances follow —
   * never the request, which the server may answer with less.
   */
  languageMode: LanguageModeAnswer | null;
  /** The same answer per turn, keyed by the server's `sessionId`. */
  languageModes: Record<string, SessionLanguageMode>;
  /**
   * The finished recording, once the conversation has stopped.
   *
   * Null while one runs, and null on a browser with no supported container — the
   * transcript never consults this, so a browser that cannot record still saves
   * and reads back exactly as it does today.
   */
  recording: ConversationRecording | null;
  /**
   * When the recorder started for the conversation on screen, as epoch ms, or
   * null before the microphone has opened for it.
   *
   * Live, unlike `recording` above, and that is what it is for: the transcript
   * marks each finished block with a position in the RECORDING, which is what
   * `/history` will show for the same block once it is read back. Both screens
   * shift by this same origin, so a block reads the same during the conversation
   * and afterwards.
   */
  recordingStartedAtMs: number | null;
  /**
   * Every pause of this conversation so far, the last one open while it is
   * paused — what the elapsed clock freezes on.
   */
  pauses: readonly PauseInterval[];
  /**
   * Time this conversation has spent in pauses that are over, in ms.
   *
   * Closed intervals only, so it does not change while a pause is on. Once the
   * conversation has ended every pause is closed — ending closes the open one —
   * and this is the total the save stores as `pausedMs`.
   */
  pausedMs: number;
  /**
   * The pauses a turn's offset leaves out — what `toConversationTurns` and the
   * live transcript measure in.
   *
   * The conversation's pauses when the recording paused with it, which is every
   * case but one: a `MediaRecorder` with no `pause()` records straight through,
   * so its media keeps wall time and this is empty, keeping every seek after a
   * pause on the words it points at.
   */
  offsetPauses: readonly PauseInterval[];
  start: (options: StartOptions) => Promise<void>;
  stop: () => void;
  /**
   * Turn the microphone off without ending the conversation, and pause the
   * clock and the recording with it.
   *
   * Not a weaker `stop`: nothing is released, the transcript stays, and
   * `conversationId` does not change — so the save that fires when a
   * conversation ends does not fire here. What was already said is still
   * translated and still spoken. The paused time is left out of the duration
   * and of every later turn's offset.
   */
  pause: () => void;
  /** Listen again, in the same conversation and on the same socket, recording again. */
  resume: () => void;
  /**
   * End the conversation, letting it finish speaking first.
   *
   * What a person pressing End should get, and what `stop` is not: the
   * microphone goes off now, and the translation of the sentence they just
   * finished is still spoken. Pressing it again while it is finishing cuts the
   * tail short.
   *
   * `stop` remains the immediate one, for the page going away and for a socket
   * that has already dropped — there is nothing to drain in either case.
   */
  end: () => void;
  /**
   * Set one language's playback gain, 0..1, taking effect immediately — `lang`
   * absent is the stage untagged (one-way) frames play through.
   *
   * Live mid-conversation because it never touches the session options: the gain
   * node sits between the playback queue and the loudspeakers, so changing it is
   * a property write rather than anything the server has to be told about.
   */
  setVolume: (volume: number, lang?: LanguageCode) => void;
}

/**
 * Runs a hands-free conversation over `/ws/translate`.
 *
 * Everything with a lifetime lives in {@link ConversationSession}, which is
 * driven by a node test suite; this hook binds its callbacks to React state and
 * supplies the browser APIs it cannot fake. Anything resembling a decision about
 * when to listen belongs in `CapturePump`, and anything about resource lifetime
 * belongs in the session — not here.
 *
 * `getVolume` is a READER for the same reason `token` below is one: the session is
 * built once, on first render, which happens before the settings have been read
 * out of storage. A volume captured by value there would be the first-render
 * default for the lifetime of the page, and the volume someone actually saved
 * would silently never apply.
 *
 * `getMicProcessing` is a reader for the same reason, and is read when the
 * microphone opens and when the session reads its runtime — both at start.
 */
export function useStreamingTranslate(
  getVolume: (lang?: LanguageCode) => number = () => 1,
  getMicProcessing: () => MicProcessing = () => DEFAULT_MIC_PROCESSING,
): UseStreamingTranslate {
  // A READER, not a value. The socket cannot open without a token —
  // /ws/translate refuses an unauthenticated upgrade before any socket exists —
  // and the session resolves asynchronously, after this hook's first render.
  // The transport below is built once, so a captured value would be the empty
  // first-render one forever. This is called at connect time instead.
  const token = useAccessToken();
  const recovery = useAuthRecovery(token);
  const [status, setStatus] = useState<ConversationStatus>('idle');
  // What is on screen is derived from the server's events by a reducer that can
  // be tested on its own; this hook only carries transport.
  const [conversation, dispatch] = useReducer(
    turnKeyedTranscriptReducer,
    initialTurnKeyedTranscript,
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // See `CreditEvent`. Written by `onServerEvent`, read by `onError` right after.
  const creditEvent = useRef<CreditEvent | null>(null);
  // The id `start` minted, read by the runtime factory when the session starts,
  // so every turn start names the conversation its credit usage belongs to.
  const conversationIdRef = useRef<string | undefined>(undefined);
  const [level, setLevel] = useState(0);
  const [echoHeard, setEchoHeard] = useState(0);
  const [micPaused, setMicPaused] = useState(false);
  // The session's own record of when this conversation was paused; see
  // `onPauses` below.
  const [pauses, setPauses] = useState<readonly PauseInterval[]>(NO_PAUSES);
  const [languageMode, setLanguageMode] = useState<LanguageModeAnswer | null>(null);

  /**
   * The gain stage the translated audio passes through, for the run in progress.
   *
   * Stale-tolerant by design: the session can stop itself (a dropped socket calls
   * its own `stop`), and `releaseResources` closes the AudioContext without
   * telling anyone outside. `onStopped` below nulls this, and `setVolume` checks
   * the context is still open, so a node belonging to a finished run is simply
   * ignored rather than being an error case to prevent.
   */
  // One gain stage per language a frame was tagged with, `''` for an untagged
  // frame — see `createPlaybackSink`.
  const gainsRef = useRef<Map<string, GainNode> | null>(null);
  // Read at sink-creation time. See the note on `getVolume` above.
  //
  // Kept current in an effect rather than assigned during render: a render can be
  // discarded or replayed, so writing a ref in one is a side effect at a moment
  // React does not promise anything about. The seeded value covers the window
  // before the first commit, and a session cannot start inside it — `start` is
  // triggered by a click.
  const getVolumeRef = useRef(getVolume);
  useEffect(() => {
    getVolumeRef.current = getVolume;
  }, [getVolume]);
  const getMicProcessingRef = useRef(getMicProcessing);
  useEffect(() => {
    getMicProcessingRef.current = getMicProcessing;
  }, [getMicProcessing]);

  // Same treatment, and for the same reason: the session below is built once, so a
  // captured translator would be the one from the first render forever.
  const t = useTranslate();
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
  const locale = useLocale();
  const localeRef = useRef(locale);
  useEffect(() => {
    localeRef.current = locale;
  }, [locale]);

  // Owned here because this is where the microphone stream is opened.
  //
  // Destructured rather than read through a ref: both are `useCallback`s with no
  // dependencies, so their identities are stable for the life of the hook and the
  // session's dependency object — built ONCE, on the first render — captures the
  // same functions it would capture on any later one. `tRef` next door needs a ref
  // because the dictionary genuinely changes; these do not.
  const {
    startedAtMs: recordingStartedAtMs,
    reset: resetRecording,
    attach: attachRecording,
    pause: pauseRecording,
    resume: resumeRecording,
    recordsThroughPause,
    finish: finishRecording,
  } = useConversationRecording();

  // Block shapes already asked to be translated whole; see the effect below.
  const askedBlocks = useRef(new Set<string>());
  // The session waiting in `onDrained` for the settled transcript's blocks to
  // be asked, and a count that renders once per settling even when settling
  // changes nothing; see the effect after the one that asks.
  const drained = useRef<(() => void) | null>(null);
  const [settlings, setSettlings] = useState(0);

  const sessionRef = useRef<ConversationSession | null>(null);
  sessionRef.current ??= new ConversationSession(
    {
      // Through the helper, which classifies the rejection and throws a sentence from
      // the dictionary. `ConversationSession` reports a failed start as `err.message`
      // and has no dictionary of its own — it is shared with the extension — so the
      // message has to arrive already translated for `error` below to be readable.
      //
      // The recorder taps the SAME stream and hands it straight back, so the
      // session receives exactly what it would have received and learns nothing
      // about recording. That is what keeps `@chatofy/realtime-client` — shared
      // with the extension — out of this feature entirely.
      //
      // Opened with the processing the reader chose. A browser may decline a
      // constraint without failing (Safari is reported to), so what it actually
      // applied is compared and a disagreement is logged rather than trusted.
      openMicrophone: async () => {
        const audio = getMicProcessingRef.current();
        const stream = await openMicrophone(tRef.current, audio);
        warnIfNotApplied(stream, audio);
        return attachRecording(stream);
      },
      createAudioContext: () => new AudioContext(),
      createWorkletNode: (context) => new AudioWorkletNode(context, 'mic-capture-processor'),
      createSocket: (handlers) =>
        new TranslateSocket(
          translateSocketUrl(env.NEXT_PUBLIC_API_BASE_URL),
          handlers,
          // Read HERE, when the socket is actually opened.
          token.current(),
        ),
      workletUrl: WORKLET_URL,
      /**
       * Playback, with a gain stage in front of the loudspeakers.
       *
       * The node is built HERE, once per run, and never cached across runs: each
       * start gets a fresh `AudioContext` (see `createAudioContext` above) and
       * `releaseResources` closes the previous one. Connecting a new run's
       * sources to a node from a closed context throws a cross-context
       * `InvalidAccessError`, and audio would die on the second conversation.
       *
       * Deliberately NOT a gain stage inside `PcmPlaybackQueue`: the extension
       * gives that class a sink that feeds the MEETING's outgoing track, where
       * attenuating "playback volume" would quietly turn down what the other
       * participants hear.
       */
      createPlaybackSink: (context, onTurnDrained) => {
        // A stage per language, built the first time a frame in it arrives: a
        // reader keeps a volume per language, and a two-way reply's frame is
        // the only thing that says which language it is in. An untagged frame
        // (a one-way turn) gets the `''` stage, whose volume the reader chose.
        const gains = new Map<string, GainNode>();
        gainsRef.current = gains;
        const stageFor = (lang?: LanguageCode): GainNode => {
          const key = lang ?? '';
          let gain = gains.get(key);
          if (!gain) {
            gain = context.createGain();
            gain.gain.value = clampVolume(getVolumeRef.current(lang));
            gain.connect(context.destination);
            gains.set(key, gain);
          }
          return gain;
        };
        return new PcmPlaybackQueue(context, onTurnDrained, stageFor);
      },
    },
    {
      onStatus: setStatus,
      onLevel: setLevel,
      // Fires only in half duplex, i.e. when echo cancellation is off
      // (`cascadeRuntimeFor`): the pump then ignores the microphone while our
      // translation is audible, and the page says so. Under full duplex the pump
      // never ignores input and this stays false.
      onMuted: setMicPaused,
      // Every connection failure asks whether the session is still valid before
      // it is reported as a fault. Without this an expired token reads as the
      // API being down and the user retries into a refusal forever. Renewal is
      // attempted first now, so signing in again is the way out only once that
      // renewal has been terminally refused.
      onError: (message, cause) => {
        // A credit code is the account's state, not a connection fault: there is
        // no session to recover. `credits_low` is a notice and stops nothing;
        // the other two end the run (the session stops itself, gracefully, so
        // what was said is still saved) and are said as its error.
        if (message !== null && cause && CREDIT_CODES.has(cause.code)) {
          const text = refusalMessage(tRef.current, localeRef.current, cause, creditEvent.current);
          if (cause.code === 'credits_low') {
            setNotice(text);
          } else {
            setNotice(null);
            setError(text ?? message);
          }
          return;
        }
        if (message === null) setNotice(null);
        setError(
          message === null
            ? null
            : (refusalMessage(tRef.current, localeRef.current, cause) ?? message),
        );
        void recovery.handleConnectionFailure();
      },
      onLanguageMode: (mode, reason) =>
        setLanguageMode(reason === undefined ? { mode } : { mode, reason }),
      onEchoHeard: () => setEchoHeard((count) => count + 1),
      // The only teardown signal that reaches outside the session. `stop()` is not
      // enough on its own: a dropped socket makes the session stop ITSELF, and
      // `releaseResources` is private with no callback, so without this the gain
      // node of a closed context would be held until the next run replaced it.
      onStopped: () => {
        gainsRef.current = null;
        setMicPaused(false);
        // The conversation is over, so this is the last moment the acoustic
        // layer can keep its promise: every turn it heard but could not place
        // gets an ordinal here. Dispatched from the teardown signal rather than
        // from `stop()` because a dropped socket makes the session stop itself,
        // and a turn left pending by a dropped socket is exactly the one that
        // most needs settling.
        dispatch({ type: 'transcript.settled' });
      },
      // The same settling, while the socket is still open. Settling can join
      // turns into a block that did not exist a moment ago — a voice placed only
      // now — and that block can only be asked for over this connection. The
      // one in `onStopped` stays for the run a dropped socket ends.
      onDrained: () =>
        new Promise<void>((resolve) => {
          drained.current = resolve;
          dispatch({ type: 'transcript.settled' });
          setSettlings((count) => count + 1);
        }),
      onServerEvent: (event: ServerEvent) => {
        if (event.type === 'server.error' && CREDIT_CODES.has(event.code)) {
          creditEvent.current = { turnId: event.turnId };
        }
        dispatch(event);
      },
      onReset: () => dispatch({ type: 'transcript.reset' }),
      // A new array on every change, straight into state: the clock, the
      // duration and every offset read it.
      onPauses: setPauses,
      // Not optional once turns run concurrently. A turn refused at a ceiling,
      // dropped from the playback backlog, or released by the stall watchdog
      // produces no `server.session.ended`, so without this its live line stays
      // on screen for the rest of the conversation.
      // The reason is not decoration: `backlog` and `stalled` are the two that
      // mean a translation existed and was never spoken, and the reducer keeps
      // those so the transcript can say so. Dropping it here is what made a lost
      // sentence indistinguishable from one that played.
      onTurnAbandoned: (sessionId, reason) =>
        dispatch({
          type: 'transcript.turnAbandoned',
          sessionId: sessionId ?? undefined,
          reason,
        }),
      // What capture measured, which the server cannot know: whether the length
      // ceiling cut the turn, when the microphone opened and closed on it, and
      // how much audio it carries from before it opened. The first three show a
      // ceiling-cut utterance as one block instead of asking who spoke two or
      // three times about one sentence; the pre-roll is what lets the timestamp
      // on that block point at its own first syllable rather than 320ms into it.
      // Arrives after that turn's `server.transcript.final`, so the reducer
      // keys it separately and rendering joins the two.
      onTurnCaptured: ({ sessionId, cutForced, openedAt, closedAt, preRollMs }) =>
        dispatch({
          type: 'transcript.turnCaptureRecorded',
          sessionId,
          cutForced,
          openedAt,
          closedAt,
          preRollMs,
        }),
      // Dropped turns and forced-on modes must never be silent — Phase 3 reads
      // exactly these, and a demo that quietly discards a sentence looks like a
      // recogniser fault.
      onLog: (message) => console.warn(`[chatofy] ${message}`),
    },
    // Full duplex unless echo cancellation is off — see `cascadeRuntimeFor`.
    // Otherwise continuous capture, the shared in-flight and length ceilings, and
    // per-turn metrics: the tuning every cascade client shares.
    // The conversation id rides on the runtime because the session reads it once
    // per start and sends it on every turn start of that run.
    () => {
      const runtime = cascadeRuntimeFor(getMicProcessingRef.current());
      const conversationId = conversationIdRef.current;
      return conversationId === undefined ? runtime : { ...runtime, conversationId };
    },
  );
  const session = sessionRef.current;

  // The durable identity of one conversation. Held together because they are one
  // fact — which conversation this is, when it began, and which language pair
  // it runs — and all three are stamped at the same moment for the reason on
  // `conversationId` above.
  const [identity, setIdentity] = useState<{
    id: string;
    startedAt: string;
    languagePair: SessionLanguagePair;
    twoWay: boolean;
  } | null>(null);

  /**
   * The finished recording, once the conversation has stopped.
   *
   * Null while one is running and null for a browser that could not record. The
   * upload reads it; the transcript never does, which is what keeps a failure to
   * record from touching the half that always works.
   */
  const [finishedRecording, setFinishedRecording] = useState<ConversationRecording | null>(null);

  const start = useCallback(
    ({ mode, ...options }: StartOptions) => {
      const twoWay = asksTwoWay(options.languagePair, mode);
      // Before `session.start`, which is what dispatches the reset: the id and
      // the transcript it names must change together, or a save fired on the
      // edge could carry the new turns under the previous id.
      const id = crypto.randomUUID();
      conversationIdRef.current = id;
      creditEvent.current = null;
      setNotice(null);
      setIdentity({
        id,
        startedAt: new Date().toISOString(),
        languagePair: options.languagePair,
        twoWay,
      });
      // The previous conversation's answer is not this one's: until a turn of
      // this one opens, nothing has said how it runs.
      setLanguageMode(null);
      setMicPaused(false);
      // The previous conversation's recording must not survive into this one:
      // the upload keys off `conversationId`, and a stale blob here would be
      // attached to the wrong conversation. Its ORIGIN must not survive either —
      // measured against the new conversation's `startedAt` it would shift the
      // first timestamps by the gap between two unrelated conversations, and the
      // microphone can take seconds to open behind a permission prompt.
      setFinishedRecording(null);
      resetRecording();
      askedBlocks.current.clear();
      // Settled text is asked for on every start; see `CASCADE_STREAM_COMMITTED`.
      //
      // `twoWay` rides only when asked, so a declared start is byte-for-byte
      // what it was before the field existed.
      return session.start({
        ...options,
        ...(twoWay ? { twoWay: true } : {}),
        streamCommitted: CASCADE_STREAM_COMMITTED,
      });
    },
    [session, resetRecording],
  );

  // Collect the recording on the falling edge, whatever caused it — a person
  // pressing End and a dropped socket both land on `idle`, and the audio so far
  // is worth keeping either way. This mirrors how the transcript save fires.
  useEffect(() => {
    if (status !== 'idle') return;
    let cancelled = false;
    void finishRecording().then((result) => {
      if (!cancelled && result) setFinishedRecording(result);
    });
    return () => {
      cancelled = true;
    };
  }, [status, finishRecording]);
  const stop = useCallback(() => session.stop(), [session]);
  // The recorder follows the session, and only on a transition the session
  // actually made: a pause it refused — while connecting, while finishing — must
  // not silence a recording the conversation is still making. Called in the
  // same tick as the session stamps its interval, so the recording skips the
  // same stretch the offsets leave out.
  const pause = useCallback(() => {
    session.pause();
    if (session.isPaused) pauseRecording();
  }, [session, pauseRecording]);
  const resume = useCallback(() => {
    const wasPaused = session.isPaused;
    session.resume();
    if (wasPaused && !session.isPaused) resumeRecording();
  }, [session, resumeRecording]);
  const end = useCallback(() => session.finish(), [session]);
  const retranslateBlock = useCallback(
    (segmentIds: string[]) => session.retranslateBlock(segmentIds),
    [session],
  );

  const setVolume = useCallback((volume: number, lang?: LanguageCode) => {
    // Only the stage of the language named, `''` for untagged frames. A stage not
    // built yet has nothing to write to and reads its volume through `getVolume`
    // when its first frame arrives; no running conversation is the same case.
    const gain = gainsRef.current?.get(lang ?? '');
    // A closed context is a run that is over.
    if (!gain || gain.context.state === 'closed') return;
    // Ramped rather than assigned. A step change in gain is an audible click,
    // which on a control someone is dragging would fire on every frame.
    gain.gain.setTargetAtTime(clampVolume(volume), gain.context.currentTime, 0.01);
  }, []);

  // Every speaker edit goes through the same dispatch the socket's events do.
  //
  // The placeholder name is written HERE rather than in the reducer's own
  // fallback: `@chatofy/realtime-client` ships to the extension too and holds no
  // dictionary, so a default it wrote would be English on a Vietnamese page. The
  // number still comes from the roster's counter, which is what keeps a name from
  // colliding with a live one after a removal.
  const addSpeaker = useCallback(
    (label?: string) =>
      dispatch({
        type: 'transcript.speakerAdded',
        label:
          label ?? t('web.translate.speakerDefault', { number: conversation.nextSpeakerNumber }),
      }),
    [t, conversation.nextSpeakerNumber],
  );
  const renameSpeaker = useCallback(
    (speakerId: string, label: string) =>
      dispatch({ type: 'transcript.speakerRenamed', speakerId, label }),
    [],
  );
  const removeSpeaker = useCallback(
    (speakerId: string) => dispatch({ type: 'transcript.speakerRemoved', speakerId }),
    [],
  );
  const attributeTurn = useCallback(
    (sessionId: string, speakerId: string) =>
      dispatch({ type: 'transcript.turnAttributed', sessionId, speakerId }),
    [],
  );
  const unattributeTurn = useCallback(
    (sessionId: string) => dispatch({ type: 'transcript.turnUnattributed', sessionId }),
    [],
  );

  // Ask for one translation of each block the length ceiling cut, once per shape
  // of the block. Pieces are translated as they arrive, before the rest of the
  // sentence exists, so their joined translations break at every cut; one
  // translation of the whole block reads as what was said, on screen and in the
  // saved record. Asked again each time the block grows. A run that has stopped
  // cannot be asked for — the server knows segments by the connection that
  // produced them — and keeps the joined pieces.
  useEffect(() => {
    if (status === 'idle') return;
    const groups = groupTurnsForDisplay(
      conversation.turns,
      conversation.captures,
      conversation.attributions,
    );
    for (const segmentIds of blocksToRetranslate(groups, conversation.blockTranslations)) {
      const key = segmentIds.join(' ');
      if (askedBlocks.current.has(key)) continue;
      askedBlocks.current.add(key);
      retranslateBlock(segmentIds);
    }
  }, [
    status,
    retranslateBlock,
    conversation.turns,
    conversation.captures,
    conversation.attributions,
    conversation.blockTranslations,
  ]);

  // Let a finishing session go once the settled transcript has been asked for.
  // After the effect above in the same commit, so its blocks are already in
  // flight — and they hold the session open until they are answered.
  useEffect(() => {
    drained.current?.();
    drained.current = null;
  }, [settlings]);

  // Release the microphone and the socket if the page goes away mid-conversation.
  useEffect(() => stop, [stop]);

  // Settle the labels if the page goes away without unmounting.
  //
  // `onStopped` covers every teardown the app performs, including a dropped
  // socket. It does NOT cover a hard tab close or a backgrounded tab the browser
  // discards — React never unmounts, so the cleanup above never runs either.
  // `pagehide` is the one event that fires in both, and unlike `beforeunload` it
  // fires when a page enters the back/forward cache too.
  //
  // Settling is a pure state update over data already in memory: no network, no
  // storage, nothing that can be cut off half-done. So the worst case here is a
  // redundant dispatch, and the best case is a transcript that ends with every
  // turn carrying an ordinal instead of the last few carrying none.
  useEffect(() => {
    const settle = () => dispatch({ type: 'transcript.settled' });
    window.addEventListener('pagehide', settle);
    return () => window.removeEventListener('pagehide', settle);
  }, []);

  // Closed pauses only — see the interface.
  const pausedMs = pauses.reduce(
    // Each interval floored at 0, as `pausedMsBefore` does: a clock stepped back
    // mid-pause must not subtract from the total.
    (total, pause) =>
      pause.endedAt === null ? total : total + Math.max(0, pause.endedAt - pause.startedAt),
    0,
  );

  return {
    status,
    turns: conversation.turns,
    liveTurns: liveTurnsInOrder(conversation),
    captures: conversation.captures,
    unheard: conversation.unheard,
    displays: conversation.displays,
    blockTranslations: conversation.blockTranslations,
    speakers: conversation.speakers,
    attributions: conversation.attributions,
    stats: attributionStats(conversation),
    addSpeaker,
    renameSpeaker,
    removeSpeaker,
    attributeTurn,
    unattributeTurn,
    echoHeard,
    micPaused,
    error,
    notice,
    level,
    conversationId: identity?.id ?? null,
    startedAt: identity?.startedAt ?? null,
    languagePair: identity?.languagePair ?? null,
    twoWayRequested: identity?.twoWay ?? false,
    languageMode,
    languageModes: conversation.languageModes,
    recording: finishedRecording,
    recordingStartedAtMs,
    pauses,
    pausedMs,
    offsetPauses: recordsThroughPause ? NO_PAUSES : pauses,
    start,
    stop,
    pause,
    resume,
    end,
    setVolume,
  };
}
