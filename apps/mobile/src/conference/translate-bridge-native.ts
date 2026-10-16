/**
 * The React Native equivalent of web's `wireTranslate`
 * (apps/web/src/hooks/use-conference.ts lines 282–425).
 *
 * Opens `/ws/translate` as a SECOND WebSocket (matching web — see the two-socket
 * note in the Phase 2 report), streams captured 16 kHz PCM16 mic frames to it,
 * and rebroadcasts the returned transcript + TTS audio to the already-open
 * `/ws/conference` socket as `conference.translation.broadcast` envelopes. The
 * message shapes are copied byte-for-byte from web so a web peer parses what
 * mobile sends and vice versa.
 *
 * Interop note (flagged in the report): web's subtitle payload carries
 * `sourceLanguage` even though `ConferenceTranslationSubtitleSchema` names the
 * field `sourceLang`. This bridge matches WEB's actual wire (`sourceLanguage`)
 * so web↔mobile interop holds; the schema discrepancy is for the API/web owners.
 */

import type { NativeAudioCapture } from './native-audio-capture';
import { pcm16BytesToBase64 } from './native-audio-capture';

/** How long to keep the "translating…" badge on if no final subtitle arrives. */
const TRANSLATING_TIMEOUT_MS = 10_000;

export interface TranslateBridgeDeps {
  /** The open /ws/conference socket to rebroadcast onto. */
  confWs: WebSocket;
  /** The mic capture adapter (already constructed, not yet started). */
  capture: NativeAudioCapture;
  /** Our own conference socketId — stamped onto every broadcast. */
  socketId: string;
  /** Our display name, shown next to the subtitle on listeners. */
  speakerDisplayName: string;
  /** Our spoken language ('en' | 'vi'); the other of the pair is the target. */
  sourceLanguage: string;
  /** Full `${wsBase}/ws/translate` URL. */
  translateUrl: string;
  /** WS subprotocol marker (WS_SUBPROTOCOL). */
  subprotocol: string;
  /** Bearer token, sent as the second subprotocol. */
  token: string;
  /** Drives the hook's `localTranslating` indicator. */
  setLocalTranslating: (v: boolean) => void;
  /** Dev log sink. */
  log: (m: string) => void;
}

/**
 * A running translate bridge. `stop()` releases the recorder and closes the
 * translate socket; the hook calls it on leave/unmount.
 */
export interface TranslateBridge {
  stop: () => Promise<void>;
  /**
   * Pause/resume translation capture when the local mic is muted/unmuted. While
   * paused no mic audio is captured or sent to /ws/translate, so a muted user is
   * never transcribed or translated (privacy).
   */
  setPaused: (paused: boolean) => void;
}

/** UUID v4 without a browser `crypto.randomUUID` dependency (RN has no DOM crypto). */
function randomUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function send(ws: WebSocket, event: string, data: unknown): void {
  ws.send(JSON.stringify({ event, data }));
}

/**
 * Start capturing the mic and translating. Returns a handle whose `stop()` tears
 * everything down. Mirrors `wireTranslate`; the capture lib replaces web's
 * ScriptProcessor and the conference socket is passed in rather than captured.
 */
export async function startTranslateBridge(deps: TranslateBridgeDeps): Promise<TranslateBridge> {
  const {
    confWs,
    capture,
    socketId,
    speakerDisplayName,
    sourceLanguage,
    translateUrl,
    subprotocol,
    token,
    setLocalTranslating,
    log,
  } = deps;

  const targetLanguage = sourceLanguage === 'en' ? 'vi' : 'en';
  const direction = `${sourceLanguage}_to_${targetLanguage}`;

  const translateWs = new WebSocket(translateUrl, [subprotocol, token]);
  const turnId = randomUuid();
  let seq = 0;
  let stopped = false;
  let paused = false;
  let translatingTimeout: ReturnType<typeof setTimeout> | null = null;

  /** Clear `localTranslating` and cancel any pending safety timeout. */
  function clearTranslating(): void {
    if (translatingTimeout !== null) {
      clearTimeout(translatingTimeout);
      translatingTimeout = null;
    }
    setLocalTranslating(false);
  }

  translateWs.addEventListener('open', () => {
    log('[translate] WS open');
    send(translateWs, 'client.live.start', { type: 'client.live.start', direction });
  });

  translateWs.addEventListener('message', (evt: MessageEvent<string>) => {
    let msg: { type: string; [k: string]: unknown };
    try {
      msg = JSON.parse(evt.data) as { type: string; [k: string]: unknown };
    } catch {
      return;
    }

    if (msg.type === 'server.live.transcript') {
      const d = msg as unknown as { channel: 'source' | 'target'; delta: string; lang: string };
      if (d.channel === 'target') {
        // [T2] final subtitle for this turn: clear the "translating…" badge.
        log(`[T2] transcript: "${d.delta}"`);
        clearTranslating();
      }
      // Field names copied from web wireTranslate (sourceLanguage, targetLang).
      send(confWs, 'conference.translation.broadcast', {
        subtitle: {
          speakerSocketId: socketId,
          speakerDisplayName,
          sourceLanguage,
          targetLang: targetLanguage,
          sourceText: d.delta,
          translatedText: d.delta,
          isFinal: d.channel === 'target',
          turnId,
        },
      });
    }

    if (msg.type === 'server.live.audio') {
      const d = msg as unknown as {
        frame: { sequence: number; sampleRate: number; payload: string };
      };
      send(confWs, 'conference.translation.broadcast', {
        audio: {
          speakerSocketId: socketId,
          lang: targetLanguage,
          sequence: d.frame.sequence,
          sampleRate: d.frame.sampleRate,
          payload: d.frame.payload,
        },
      });
    }
  });

  translateWs.addEventListener('close', () => {
    clearTranslating();
    log('[translate] WS closed');
  });
  translateWs.addEventListener('error', () => log('[translate] WS error'));

  // Begin capture. Each PCM16 frame → client.live.audio on the translate socket.
  await capture.start((bytes, _frameSeq) => {
    if (stopped || paused || translateWs.readyState !== WebSocket.OPEN) return;

    if (seq === 0) {
      // [T1] start of a new turn: show the "translating…" badge with a safety
      // timeout so it never sticks on if no final subtitle arrives.
      log('[T1] first audio frame');
      if (translatingTimeout !== null) clearTimeout(translatingTimeout);
      setLocalTranslating(true);
      translatingTimeout = setTimeout(() => {
        translatingTimeout = null;
        setLocalTranslating(false);
        log('[translate] translating timeout — badge cleared');
      }, TRANSLATING_TIMEOUT_MS);
    }

    send(translateWs, 'client.live.audio', {
      type: 'client.live.audio',
      frame: {
        sessionId: turnId,
        encoding: 'pcm16',
        sampleRate: 16000,
        sequence: seq++,
        timestamp: Date.now(),
        payload: pcm16BytesToBase64(bytes),
      },
    });
  });

  return {
    setPaused(next: boolean): void {
      if (next === paused) return;
      paused = next;
      if (next) {
        // Stop feeding STT/MT at the source and drop the badge — a muted user is
        // not translating.
        capture.pause();
        clearTranslating();
      } else {
        capture.resume();
      }
    },
    async stop(): Promise<void> {
      if (stopped) return;
      stopped = true;
      clearTranslating();
      await capture.stop();
      if (
        translateWs.readyState === WebSocket.OPEN ||
        translateWs.readyState === WebSocket.CONNECTING
      ) {
        translateWs.close();
      }
    },
  };
}
