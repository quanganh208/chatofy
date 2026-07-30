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
  direction: TranslationDirection;
  voiceGender: VoiceGender;
  /** `http(s)://host` of the API. The socket URL is derived from it. */
  apiBaseUrl: string;
  /** Report per-turn timings to the server. Off unless someone is collecting. */
  reportMetrics: boolean;
}

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

/** What the capture side is doing, in the words the popup shows. */
export interface CaptureStatus {
  capturing: boolean;
  /** Present when capture stopped because something went wrong. */
  error?: string;
  /** Turns waiting to be heard. Non-zero means the translation is behind. */
  backlogTurns: number;
  /** Times the microphone heard our own playback. The loudspeaker measurement. */
  echoEvents: number;
}

/** One turn on screen. `final` lines stay; the rest are replaced as they grow. */
export interface TranscriptLine {
  sessionId: string;
  sourceText: string;
  targetText: string;
  final: boolean;
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
  error?: string;
  /**
   * The keyboard shortcut Chrome assigned to the toggle command, if it assigned one.
   *
   * Carried here because the overlay needs it and cannot ask: `chrome.commands` is
   * not available to content scripts. `undefined` means no binding — the overlay
   * then points at the context menu instead of printing a key nobody can press.
   */
  shortcut?: string;
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
