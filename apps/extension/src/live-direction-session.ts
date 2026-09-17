import {
  LiveSession,
  MicrophoneGraph,
  type LiveSessionDeps,
  type PlaybackSink,
} from '@chatofy/realtime-client';
import type { TranslationDirection, TranslationHints } from '@chatofy/types';
import type { DirectionSessionDeps } from './direction-session';
import type { DirectionRunner } from './meeting-capture';
import { SoundingSink } from './sounding-sink';

/**
 * One direction of the meeting, translated by the continuous backend.
 *
 * A sibling of `createDirectionSession`, never a mode inside it. It presents the
 * same {@link DirectionRunner} face, so `MeetingCapture` drives either without
 * knowing which it holds — the ducking, the microphone gate, the echo monitor
 * and the teardown ordering are all written once, against that interface.
 *
 * Three things genuinely differ, and each is a decision rather than a detail:
 *
 *   CAPTURE has no gate. `MicrophoneGraph` rather than `ConversationSession`'s
 *   `CapturePump`, because this backend has no endpoint event — it learns an
 *   utterance ended from trailing quiet, so withholding silence truncates the
 *   translation. See the class comment on `LiveSession`.
 *
 *   DUCKING follows audible audio, not open turns. The cascade ducks on
 *   `OrderedPlayback.isBusy`, which counts turns still waiting; there are no
 *   turns here, and nothing would ever release it. So `onBusy` is reported from
 *   the same signal as `onSounding` — audio queued or playing right now, which
 *   for this backend means frames are arriving. `DuckController`'s release delay
 *   is what keeps a queue running dry between two clauses from swelling the
 *   meeting back up.
 *
 *   TEXT arrives as deltas under one session id that lasts the whole meeting,
 *   so it appends to a single line per direction instead of opening a turn per
 *   sentence. The line is capped in the reducer.
 */

/**
 * The transcript key this direction's line lives under.
 *
 * Synthetic, and NOT the server's session id, for two reasons. It exists from
 * construction, so a delta can never arrive before there is a line to put it on.
 * And `MeetingTranscript` orders both directions through one `firstSeen` map
 * keyed by this id, so the two directions must never collide — they translate
 * opposite ways, which is exactly what makes this unique.
 */
function transcriptKey(direction: TranslationDirection): string {
  return `live:${direction}`;
}

/**
 * The browser this session runs in, injected.
 *
 * Same split the rest of `src/` keeps and for the same reason: what is worth
 * testing here is the wiring between a sounding queue, a duck and a teardown,
 * and none of that is reachable from a test if constructing the class reaches
 * for `AudioWorkletNode` and `WebSocket`. `createDirectionSession` supplies the
 * real ones; it is the untested layer by design.
 */
export interface LiveDirectionBrowser {
  createWorkletNode: (context: AudioContext) => AudioWorkletNode;
  createSocket: LiveSessionDeps['createSocket'];
  /** The playback leaf for audio that plays on THIS machine. */
  createQueue: (context: AudioContext, onDrained: () => void) => PlaybackSink;
}

export class LiveDirectionSession implements DirectionRunner {
  private readonly session: LiveSession;
  private readonly mic: MicrophoneGraph;
  private readonly sink: SoundingSink;
  private readonly key: string;
  /** Set by our own `stop()`, so a teardown we asked for is not reported back. */
  private stopped = false;

  constructor(
    private readonly deps: DirectionSessionDeps,
    browser: LiveDirectionBrowser,
  ) {
    this.key = transcriptKey(deps.direction);
    this.sink = this.buildSink(browser);

    this.mic = new MicrophoneGraph({
      // Already open, and owned by `MeetingCapture`: this is either the captured
      // tab or the gated microphone.
      openMicrophone: () => Promise.resolve(deps.input),
      createAudioContext: () => deps.context,
      createWorkletNode: browser.createWorkletNode,
      workletUrl: deps.workletUrl,
      // The context carries the meeting's own passthrough and the other
      // direction. Closing it here would silence the meeting permanently on
      // something as ordinary as this socket dropping.
      ownsAudioResources: false,
    });

    this.session = new LiveSession(
      {
        createSocket: browser.createSocket,
        // The rate travels with each chunk because it is the backend's, not
        // ours: capture is 16 kHz and this answers at 24 kHz.
        play: (samples, sampleRate) => this.sink.enqueue(this.key, samples, sampleRate),
      },
      {
        onSourceText: (delta) => this.appendText('source', delta),
        onTargetText: (delta) => this.appendText('target', delta),
        onError: (message) => deps.onError(message),
        onEnded: () => {
          // Suppressed after our own stop: `MeetingCapture.stopDirection` has
          // already cleared its slot, and reporting again would have the inbound
          // direction tear down a capture that is mid-teardown.
          if (!this.stopped) deps.onStopped();
        },
      },
    );
  }

  /**
   * Where translated audio goes, and the one place `sounding` is derived.
   *
   * Mirrors `createDirectionSession`: the outbound direction may ship samples
   * into the meeting page, everything else plays on this machine. Both are
   * wrapped so the gate and the duck learn when audio is actually audible —
   * a page sink finishes on a clock and has nothing to announce, so the wrapper
   * polls it.
   */
  private buildSink(browser: LiveDirectionBrowser): SoundingSink {
    const report = (sounding: boolean) => {
      this.deps.onSounding(sounding);
      // The duck's signal too, unlike the cascade. See the class comment.
      this.deps.onBusy(sounding);
    };

    // A holder either way, because the leaf is built before the wrapper and has
    // to reach it afterwards: a drain has to be seen by the thing that reports
    // sounding, and that thing does not exist yet when the leaf is constructed.
    const wrapper: { current?: SoundingSink } = {};
    const drained = () => wrapper.current?.sync();
    const leaf = this.deps.createSink
      ? this.deps.createSink(drained)
      : browser.createQueue(this.deps.context, drained);
    wrapper.current = new SoundingSink(leaf, report);
    return wrapper.current;
  }

  private appendText(channel: 'source' | 'target', delta: string): void {
    this.deps.onServerEvent({
      type: 'transcript.liveDelta',
      sessionId: this.key,
      channel,
      delta,
    });
  }

  /**
   * Open the microphone, then the upstream session.
   *
   * `voiceGender` is deliberately unused: this backend speaks with its own voice
   * and takes no voice selector. The setting stays meaningful for the cascade,
   * and the popup says so rather than offering a control that does nothing.
   *
   * `hints` is unused for the same reason. This backend's socket protocol takes
   * no hint parameter at all, so there is nothing here to forward it to.
   * Accepting and ignoring it — rather than narrowing this class's own
   * `start` signature — is what keeps one `DirectionRunner` shape across both
   * backends; `MeetingCapture` drives either without knowing which it holds.
   */
  async start(options: {
    direction: TranslationDirection;
    hints?: TranslationHints;
  }): Promise<void> {
    this.deps.onReset();
    // Capture first, and unconditionally. Blocks captured before the upstream is
    // ready are HELD by `LiveSession`, not dropped — a user starts talking the
    // moment they press start, and discarding that window truncates the first
    // utterance of every conversation.
    await this.mic.open((block) => this.session.pushBlock(block));
    await this.session.start(options.direction);
  }

  /**
   * Release everything now, rather than letting the socket drain.
   *
   * The web page keeps its socket open past `stop()` so translated audio still
   * in flight can play. Here it must not: a stop is `MeetingCapture` tearing the
   * capture down, and the shared `AudioContext` closes moments later — so the
   * trailing audio has nowhere left to play, and a socket kept open for it would
   * hold a metered upstream session alive with no way to reach it.
   */
  stop(): void {
    this.stopped = true;
    this.mic.close();
    this.sink.stop();
    this.session.dispose();
  }

  /**
   * No per-turn metrics row on this path, so the count has nowhere to land.
   *
   * The echo monitor still runs and still gates the microphone through
   * `onSounding` — this only drops the number it would have reported.
   */
  noteEchoHeard(): void {}
}
