import { ConversationSession, TranslateSocket, translateSocketUrl } from '@chatofy/realtime-client';
import type { ServerEvent, TranslationDirection } from '@chatofy/types';
import type { CaptureSettings } from './messages';
import { SoundingSink } from './sounding-sink';

/**
 * One direction of the conversation: an input stream, a socket, and a place to
 * put the translated audio.
 *
 * Extracted so the two directions cannot drift. They differ in four things —
 * where the audio comes from, which way it is translated, how many turns they
 * keep open, and where the result goes — and everything else about them, which
 * is the entire turn-taking configuration, has to stay identical. Two call sites
 * building this by hand is how one of them quietly loses `continuous` or gets a
 * different utterance ceiling.
 */

/** Length ceiling for one turn. Provisional; phase 3's measurements settle it. */
const MAX_UTTERANCE_MS = 8000;

export interface DirectionSessionDeps {
  /** Shared by both directions and by the echo monitor. Owned by the caller. */
  context: AudioContext;
  workletUrl: string;
  settings: CaptureSettings;
  direction: TranslationDirection;
  /** What this direction listens to: the captured tab, or the gated microphone. */
  input: MediaStream;
  /** Turns this direction keeps open at the server. */
  maxInFlight: number;
  onServerEvent: (event: ServerEvent) => void;
  /** Cleared when a run starts over. */
  onReset: () => void;
  onTurnAbandoned: (sessionId: string | null) => void;
  /** A failure belonging to THIS direction. `undefined` clears it. */
  onError: (message: string | undefined) => void;
  /**
   * Turns queued or waiting, from `OrderedPlayback.isBusy`.
   *
   * This is the ducking signal, and only that. It goes true when a turn OPENS,
   * so anything that must track audible sound has to use {@link onSounding}.
   */
  onBusy: (busy: boolean) => void;
  /** Audio for some turn is queued or playing right now. The gating signal. */
  onSounding: (sounding: boolean) => void;
  /** This direction has ended, including when it ended itself. */
  onStopped: () => void;
  onLog: (message: string) => void;
}

/**
 * Build one direction's session. The caller starts it.
 *
 * The runtime options are the whole reason the extension can do this at all:
 *
 *   fullDuplex   — safe here, unlike on a shared phone. Playback happens outside
 *                  the captured tab's graph, so translated audio cannot be
 *                  re-captured. The loop is gone structurally.
 *   continuous   — capture never stops, so a turn ending returns straight to
 *                  listening instead of waiting to be re-armed.
 *   maxUtterance — someone in a meeting will not leave a 500ms silence for tens
 *                  of seconds, so length is what has to end a turn.
 */
export function createDirectionSession(deps: DirectionSessionDeps): ConversationSession {
  return new ConversationSession(
    {
      // Already open, and owned by the caller: this is either the captured tab
      // or the gated microphone, and neither is this session's to acquire.
      openMicrophone: () => Promise.resolve(deps.input),
      createAudioContext: () => deps.context,
      createWorkletNode: (ctx) => new AudioWorkletNode(ctx, 'mic-capture-processor'),
      createSocket: (handlers) =>
        new TranslateSocket(translateSocketUrl(deps.settings.apiBaseUrl), handlers),
      // Both directions monitor through this machine's loudspeakers for now; the
      // outbound one gets a sink that ships into the meeting page later. What is
      // needed today is the transition report the plain queue does not give.
      createPlaybackSink: (context, onTurnDrained) =>
        new SoundingSink(context, onTurnDrained, deps.onSounding),
      workletUrl: deps.workletUrl,
      // The caller owns the context and the input stream, not this session. A
      // session that closed those on teardown would, on something as ordinary as
      // the API restarting mid-call, silence the meeting permanently: the tab is
      // already muted by `tabCapture`, and the graph replaying it lives in that
      // same context. It would also take the OTHER direction down with it.
      ownsAudioResources: false,
    },
    {
      // Deliberately not routed to the status push. `onStatus` fires on every
      // audio frame — several times a second per turn — and each push costs an
      // IPC round trip and a `chrome.tabs.query` behind the menu title. Worse, a
      // status carrying no error clears the error banner, so a real failure
      // would be wiped within 200ms by the healthy direction.
      onStatus: () => {},
      onLevel: () => {},
      onMuted: () => {},
      onError: (message) => deps.onError(message ?? undefined),
      onEchoHeard: () => {},
      onPlaybackBusy: deps.onBusy,
      onServerEvent: deps.onServerEvent,
      onReset: deps.onReset,
      onTurnAbandoned: (sessionId) => deps.onTurnAbandoned(sessionId),
      onLog: deps.onLog,
      onStopped: deps.onStopped,
    },
    () => ({
      fullDuplex: true,
      continuous: true,
      maxUtteranceMs: MAX_UTTERANCE_MS,
      maxInFlight: deps.maxInFlight,
      reportMetrics: deps.settings.reportMetrics,
    }),
  );
}
