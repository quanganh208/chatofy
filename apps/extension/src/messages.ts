import type { TranslationDirection, VoiceGender } from '@chatofy/types';

/**
 * Everything the four extension contexts say to each other.
 *
 * MV3 splits this feature across a popup, a service worker, an offscreen document
 * and a content script, and `chrome.runtime.sendMessage` carries `any`. A typed
 * union in one file is what stops a renamed field from becoming a message that is
 * silently ignored — there is no compiler error for sending a shape nobody handles,
 * and no runtime error either.
 *
 * Every message names its destination, because all of them arrive at every
 * listener. Without that, the offscreen document sees the popup's messages to the
 * worker and has to guess which are meant for it.
 */

export interface CaptureSettings {
  /**
   * Which way the MEETING is translated: what the other participants say, into
   * the language the user reads. The user's own speech is translated the other
   * way, derived from this rather than configured beside it — two directions a
   * user could set independently is two ways to describe one conversation.
   */
  direction: TranslationDirection;
  voiceGender: VoiceGender;
  /** `http(s)://host` of the API. The socket URL is derived from it. */
  apiBaseUrl: string;
  /** Report per-turn timings to the server. Off unless someone is collecting. */
  reportMetrics: boolean;
  /**
   * Translate what the USER says as well, and send it to the meeting.
   *
   * Off by default, and that is not timidity: this direction reaches into the
   * meeting page and replaces what everyone else hears from this microphone. It
   * has to be a choice someone made.
   */
  outbound: boolean;
}

/**
 * What the outbound direction is doing, in the words the overlay shows.
 *
 * `monitor` is not a degraded `sending` — it is the honest name for translating
 * the user's speech and playing it back to the user alone, which is all that is
 * possible until the meeting page carries the injection patch.
 */
export type OutboundState = 'off' | 'monitor' | 'sending';

export type ExtensionMessage =
  /** Popup → worker: begin translating this tab. */
  | { to: 'worker'; type: 'start'; tabId: number }
  /** Popup → worker: stop. */
  | { to: 'worker'; type: 'stop' }
  /**
   * Overlay → worker: start or stop, whichever the sending tab is not doing.
   *
   * No tab id: a content script cannot learn its own, and the worker reads it from
   * the message sender, which the page cannot forge.
   */
  | { to: 'worker'; type: 'toggle' }
  /**
   * Overlay → worker: store these and apply them now.
   *
   * The worker owns the write rather than the content script doing it directly, for
   * two reasons. The offscreen document is handed its settings once, when capture
   * opens, so a direction changed mid-call has to reopen the capture — which only
   * the worker can do. And importing the settings module into a content script
   * pulled the whole shared types package onto every meeting page.
   */
  | {
      to: 'worker';
      type: 'settings';
      direction: TranslationDirection;
      voiceGender: VoiceGender;
      outbound: boolean;
    }
  /** Popup → worker: what is happening right now? */
  | { to: 'worker'; type: 'query' }
  /** Worker → offscreen: open the audio graph on this captured stream. */
  | {
      to: 'offscreen';
      type: 'begin';
      streamId: string;
      tabId: number;
      settings: CaptureSettings;
    }
  /** Worker → offscreen: tear the audio graph down. */
  | { to: 'offscreen'; type: 'end' }
  /** Offscreen → worker: how it is going, forwarded to popup and overlay. */
  | { to: 'worker'; type: 'status'; status: CaptureStatus }
  /**
   * Offscreen → worker → content: the whole transcript for the overlay.
   *
   * The whole set in one message, not a message per line. Partials arrive several
   * times a second per turn, and with three turns in flight a message per line meant
   * ~100 messages a second, each triggering a full rebuild of the overlay list inside
   * the meeting tab.
   */
  | { to: 'worker'; type: 'transcript'; lines: TranscriptLine[] }
  /** Worker → content: render this state. */
  | { to: 'content'; type: 'render'; state: OverlayState };

/**
 * Failures, kept apart by which of them failed.
 *
 * One field for all of them loses the only thing worth knowing. The two
 * directions run on two sockets and either can die alone: a dropped outbound
 * socket leaves the meeting perfectly translated INTO the user's language while
 * nothing they say reaches anyone, and a single string cannot say that.
 *
 * `capture` belongs to the worker — a tab that cannot be captured at all — and
 * the other two to the offscreen document.
 */
interface DirectionErrors {
  capture?: string;
  inbound?: string;
  outbound?: string;
}

/** What the capture side is doing, in the words the popup shows. */
export interface CaptureStatus {
  capturing: boolean;
  /** What the outbound direction is doing, or `off` when it is not running. */
  outbound: OutboundState;
  /**
   * Present when something went wrong, per direction.
   *
   * Merged by the receiver rather than assigned: a report about one direction
   * carries nothing about the other, and overwriting would erase a live failure
   * every time the healthy direction said anything.
   */
  errors: Omit<DirectionErrors, 'capture'>;
  /** Turns waiting to be heard. Non-zero means the translation is behind. */
  backlogTurns: number;
  /**
   * Times the echo microphone heard the INBOUND translation while it played.
   *
   * Inbound only, deliberately. With the outbound direction monitoring through
   * the same loudspeakers, that microphone also hears the user's own translation
   * coming back — counting both would merge two different measurements into one
   * number that means neither.
   */
  echoEvents: number;
}

/** One turn on screen. `final` lines stay; the rest are replaced as they grow. */
export interface TranscriptLine {
  sessionId: string;
  sourceText: string;
  targetText: string;
  final: boolean;
  /**
   * Who said it: the meeting, or the person running the extension.
   *
   * Not decoration. With both directions running, the transcript interleaves two
   * conversations that are translations of each other, and without a side the
   * reader cannot tell a sentence they said from a sentence said to them.
   */
  origin: 'them' | 'me';
}

export interface OverlayState {
  /**
   * Whether the meeting's audio is being captured right now.
   *
   * The overlay shows this for as long as it is true and offers no way to hide it.
   * Everyone in a meeting is being recorded by this feature, and only the person
   * running it knows — an indicator that can be dismissed is not an indicator.
   */
  capturing: boolean;
  lines: TranscriptLine[];
  /** What the outbound direction is doing. `off` while capture is not running. */
  outbound: OutboundState;
  errors: DirectionErrors;
  /**
   * Whether this tab carries the page-world microphone patch.
   *
   * A page loaded before the patch was registered cannot be given it
   * retroactively, and nothing about that is visible to the user unless it is
   * said. False while outbound is on means their speech is being translated for
   * them alone.
   */
  patched?: boolean;
  /**
   * The keyboard shortcut Chrome assigned to the toggle command, if it assigned one.
   *
   * Carried here because the overlay needs it and cannot ask: `chrome.commands` is
   * not available to content scripts. `undefined` means no binding — the overlay
   * then points at the context menu instead of printing a key nobody can press.
   */
  shortcut?: string;
  /**
   * What the overlay's own direction and voice selects should show.
   *
   * Sent from the worker because the overlay must not read storage itself: the two
   * surfaces that can change these — this one and the popup — would otherwise drift
   * apart until the page reloaded.
   */
  settings?: Pick<CaptureSettings, 'direction' | 'voiceGender' | 'outbound'>;
}

/** Narrow an incoming message to the ones this context is meant to handle. */
export function forContext<T extends ExtensionMessage['to']>(
  message: unknown,
  to: T,
): Extract<ExtensionMessage, { to: T }> | null {
  if (typeof message !== 'object' || message === null) return null;
  const candidate = message as { to?: unknown };
  if (candidate.to !== to) return null;
  return message as Extract<ExtensionMessage, { to: T }>;
}
