/**
 * The React Native equivalent of web's `wireTranslate`.
 *
 * Opens `/ws/translate` as a SECOND WebSocket (matching web), streams captured
 * 16 kHz PCM16 mic frames to it, and rebroadcasts the returned transcript + TTS
 * audio onto the already-open `/ws/conference` socket as
 * `conference.translation.broadcast` envelopes in the shared
 * `ConferenceTranslationBroadcast` shape.
 *
 * Transcript deltas are grouped into turns by `TurnAccumulator`: each delta
 * sends the turn's cumulative texts as a provisional subtitle, and a quiet gap
 * closes the turn with one `isFinal: true` frame. The "Translating…" indicator
 * follows the open turn.
 */

import type { LanguageCode } from '@chatofy/types/domain';
import type { ConferenceTranslationBroadcast } from '@chatofy/types/events';
import type { NativeAudioCapture } from './native-audio-capture';
import { pcm16BytesToBase64 } from './native-audio-capture';
import { TurnAccumulator, type TurnFrame } from './conference-turn-accumulator';

export interface TranslateBridgeDeps {
  /** The open /ws/conference socket to rebroadcast onto. */
  confWs: WebSocket;
  /** The mic capture adapter (already constructed, not yet started). */
  capture: NativeAudioCapture;
  /** Our own conference socketId — stamped onto every broadcast. */
  socketId: string;
  /** Our display name, shown next to the subtitle on listeners. */
  speakerDisplayName: string;
  /** Our spoken language; the other of the vi/en pair is the target. */
  sourceLanguage: LanguageCode;
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

function broadcast(ws: WebSocket, envelope: ConferenceTranslationBroadcast): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  send(ws, 'conference.translation.broadcast', envelope);
}

type TranslateServerMessage =
  | { type: 'server.live.transcript'; channel: 'source' | 'target'; delta: string }
  | { type: 'server.live.audio'; frame: { sequence: number; sampleRate: number; payload: string } }
  | { type: 'server.live.ended' }
  | { type: string };

/**
 * Start capturing the mic and translating. Returns a handle whose `stop()` tears
 * everything down. The conference socket is passed in rather than captured.
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

  const targetLanguage: LanguageCode = sourceLanguage === 'en' ? 'vi' : 'en';
  const languagePair = { source: sourceLanguage, target: targetLanguage };

  const translateWs = new WebSocket(translateUrl, [subprotocol, token]);
  // Identifies this live session's audio frames; turns get their own ids.
  const sessionId = randomUuid();
  const state = { seq: 0, stopped: false, paused: false };

  const turns = new TurnAccumulator({
    newTurnId: randomUuid,
    onTurnActive: setLocalTranslating,
    emit: (frame: TurnFrame) => {
      if (frame.isFinal) log(`[T2] turn closed: "${frame.translatedText}"`);
      broadcast(confWs, {
        subtitle: {
          speakerSocketId: socketId,
          speakerDisplayName,
          sourceLanguage,
          targetLanguage,
          sourceText: frame.sourceText,
          translatedText: frame.translatedText,
          isFinal: frame.isFinal,
          turnId: frame.turnId,
        },
      });
    },
  });

  const onOpen = (): void => {
    log('[translate] WS open');
    send(translateWs, 'client.live.start', { type: 'client.live.start', languagePair });
  };

  const onMessage = (evt: MessageEvent<string>): void => {
    let msg: TranslateServerMessage;
    try {
      msg = JSON.parse(evt.data) as TranslateServerMessage;
    } catch {
      return;
    }

    // Deltas and speech that arrive after a mute are for words said before it
    // (nothing is captured while paused), so they still go out.
    if (msg.type === 'server.live.transcript' && 'channel' in msg) {
      if (typeof msg.delta !== 'string') return;
      if (msg.channel !== 'source' && msg.channel !== 'target') return;
      turns.push(msg.channel, msg.delta);
      return;
    }

    if (msg.type === 'server.live.audio' && 'frame' in msg) {
      broadcast(confWs, {
        audio: {
          speakerSocketId: socketId,
          lang: targetLanguage,
          sequence: msg.frame.sequence,
          sampleRate: msg.frame.sampleRate,
          payload: msg.frame.payload,
        },
      });
      return;
    }

    if (msg.type === 'server.live.ended') {
      // No more deltas will come for this turn; close it now.
      turns.close();
    }
  };

  const onClose = (): void => {
    turns.close();
    log('[translate] WS closed');
  };

  const onError = (): void => log('[translate] WS error');

  translateWs.addEventListener('open', onOpen);
  translateWs.addEventListener('message', onMessage);
  translateWs.addEventListener('close', onClose);
  translateWs.addEventListener('error', onError);

  // Begin capture. Each PCM16 frame → client.live.audio on the translate socket.
  try {
    await capture.start((bytes) => {
      if (state.stopped || state.paused || translateWs.readyState !== WebSocket.OPEN) return;
      send(translateWs, 'client.live.audio', {
        type: 'client.live.audio',
        frame: {
          sessionId,
          encoding: 'pcm16',
          sampleRate: 16000,
          sequence: state.seq++,
          timestamp: Date.now(),
          payload: pcm16BytesToBase64(bytes),
        },
      });
    });
  } catch (err) {
    // Do not leave the translate socket open without a recorder behind it.
    state.stopped = true;
    turns.dispose();
    translateWs.close();
    throw err;
  }

  return {
    setPaused(next: boolean): void {
      if (next === state.paused || state.stopped) return;
      state.paused = next;
      if (next) {
        // Stop feeding STT/MT at the source. The open turn closes on its own
        // once the translation of what was said before muting has drained.
        capture.pause();
      } else {
        capture.resume();
      }
    },
    async stop(): Promise<void> {
      if (state.stopped) return;
      state.stopped = true;
      // Send the closing frame while the conference socket may still be open.
      turns.close();
      translateWs.removeEventListener('open', onOpen);
      translateWs.removeEventListener('message', onMessage);
      translateWs.removeEventListener('close', onClose);
      translateWs.removeEventListener('error', onError);
      if (
        translateWs.readyState === WebSocket.OPEN ||
        translateWs.readyState === WebSocket.CONNECTING
      ) {
        translateWs.close();
      }
      await capture.stop();
    },
  };
}
