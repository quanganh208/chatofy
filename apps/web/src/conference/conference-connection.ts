/**
 * A conference call's lifetime across sockets: connect, reconnect, end.
 *
 * Each socket gets its own `CallAttempt`. An unexpected close disposes it and,
 * unless the server said not to come back (close codes 4000 / 4001, a refused
 * join, `conference.ended`), opens a new socket after a bounded backoff. Each
 * attempt reads a FRESH access token: the first one expires fifteen minutes
 * into a call, and a reconnect that reused it would be refused at the upgrade.
 */
import { WS_SUBPROTOCOL } from '@chatofy/types/events';
import type { LanguageCode } from '@chatofy/types';
import { AttemptDisposedError, CallAttempt } from './conference-call-attempt';
import { closeOutcome, joinRefusalOutcome } from './conference-connection-policy';
import { conferenceDebug } from './conference-debug-log';
import { ConferenceRequestError } from './conference-signaling';
import type { ConferenceErrorReason, ConferenceSink, ConferenceStatus } from './conference-types';
import { MediaPermissionError } from './acquire-local-media';

export interface ConferenceConnectionOptions {
  /** Origin of the API's sockets, e.g. `wss://api.example.com`. */
  wsBaseUrl: string;
  /** Full `ws(s)://…/ws/translate` endpoint for the speaker's translate leg. */
  translateSocketUrl: string;
  roomId: string;
  displayName: string;
  sourceLanguage: LanguageCode;
  /**
   * Resolves the CURRENT access token; called once per attempt, and by the
   * translate leg for every session it builds.
   */
  getToken: () => Promise<string | undefined>;
  sink: ConferenceSink;
}

export class ConferenceConnection {
  private ws: WebSocket | null = null;
  private attempt: CallAttempt | null = null;
  /** Reconnect attempts since the last successful join. */
  private attemptsMade = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /** Left, or stopped for good. Nothing reconnects once this is set. */
  private closed = false;
  private muted = false;
  private videoEnabled = true;

  constructor(private readonly options: ConferenceConnectionOptions) {}

  start(): void {
    this.options.sink.status('connecting');
    void this.connect(false);
  }

  /** The user left. Releases everything; the status goes back to idle. */
  leave(): void {
    this.stop('idle');
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.attempt?.setMuted(muted);
  }

  setVideoEnabled(videoEnabled: boolean): void {
    this.videoEnabled = videoEnabled;
    this.attempt?.setVideoEnabled(videoEnabled);
  }

  sendChat(text: string): void {
    this.attempt?.sendChat(text);
  }

  async resumeAudio(): Promise<void> {
    await this.attempt?.resumeAudio();
  }

  private async connect(isReconnect: boolean): Promise<void> {
    let token: string | undefined;
    try {
      token = await this.options.getToken();
    } catch {
      token = undefined;
    }
    if (this.closed) return;
    if (!token) {
      if (!isReconnect) {
        this.stop('error', 'not-authenticated');
        this.options.sink.unauthenticated();
        return;
      }
      // A session read can fail on the same network fault that dropped the
      // socket; that is one failed attempt, not a signed-out user.
      this.afterClose(1006);
      return;
    }

    const ws = new WebSocket(`${this.options.wsBaseUrl}/ws/conference`, [WS_SUBPROTOCOL, token]);
    this.ws = ws;
    ws.addEventListener('open', () => void this.runAttempt(ws, isReconnect));
    ws.addEventListener('close', (evt: CloseEvent) => {
      if (ws !== this.ws) return;
      conferenceDebug(`socket closed (${evt.code})`);
      this.ws = null;
      this.releaseAttempt();
      this.afterClose(evt.code);
    });
  }

  private async runAttempt(ws: WebSocket, isReconnect: boolean): Promise<void> {
    if (ws !== this.ws || this.closed) return;
    const attempt = new CallAttempt({
      ws,
      roomId: this.options.roomId,
      displayName: this.options.displayName,
      sourceLanguage: this.options.sourceLanguage,
      getToken: this.options.getToken,
      translateSocketUrl: this.options.translateSocketUrl,
      muted: this.muted,
      videoEnabled: this.videoEnabled,
      sink: this.options.sink,
      onEnded: () => this.stop('disconnected', 'room-ended'),
    });
    this.attempt = attempt;

    try {
      const { audioOnly } = await attempt.run();
      if (this.attempt !== attempt) return;
      this.attemptsMade = 0;
      this.options.sink.reconnectAttempt(0);
      this.options.sink.status('in-call', audioOnly ? 'audio-only' : undefined);
    } catch (err) {
      if (this.attempt !== attempt || this.closed || err instanceof AttemptDisposedError) return;
      conferenceDebug(`join failed: ${String(err)}`);
      const refusal =
        err instanceof ConferenceRequestError && err.event === 'conference.join'
          ? joinRefusalOutcome(err.code)
          : undefined;
      if (refusal?.kind === 'stop') {
        this.stop('error', refusal.reason);
      } else if (refusal?.kind === 'retry') {
        // A refusal the server may lift: counted as one failed attempt, and
        // closing lands in the close handler, which backs off or gives up.
        ws.close(1000, 'retry');
      } else if (err instanceof MediaPermissionError) {
        this.stop('error', 'permission-denied');
      } else if (isReconnect) {
        // Counted like any other drop: closing lands in the close handler,
        // which retries or gives up.
        ws.close(1000, 'retry');
      } else {
        this.stop('error', 'generic');
      }
    }
  }

  /** Decide, after a socket went away, whether to retry or stop. */
  private afterClose(code: number): void {
    if (this.closed) return;
    this.resetCallView();
    const outcome = closeOutcome(code, this.attemptsMade);
    if (outcome.kind === 'stop') {
      this.stop('disconnected', outcome.reason);
      return;
    }
    this.attemptsMade = outcome.attempt;
    this.options.sink.reconnectAttempt(outcome.attempt);
    this.options.sink.status('reconnecting');
    conferenceDebug(`reconnect ${outcome.attempt} in ${outcome.delayMs}ms`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect(true);
    }, outcome.delayMs);
  }

  /** End the call for good and report where it ended up. */
  private stop(status: ConferenceStatus, reason?: ConferenceErrorReason): void {
    if (this.closed) return;
    this.closed = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const ws = this.ws;
    this.ws = null;
    const close = () => {
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        ws.close(1000, 'left');
      }
    };
    const attempt = this.attempt;
    this.attempt = null;
    if (attempt && status === 'idle' && ws?.readyState === WebSocket.OPEN) {
      // The user left an open call: the attempt lets the translate leg's
      // in-flight turns reach the room, then closes the socket itself. Its
      // close event is ignored — `this.ws` no longer points at it.
      attempt.dispose(close);
    } else {
      attempt?.dispose();
      close();
    }
    this.resetCallView();
    this.options.sink.reconnectAttempt(0);
    this.options.sink.status(status, reason);
  }

  private releaseAttempt(): void {
    this.attempt?.dispose();
    this.attempt = null;
  }

  /** Clear what the screen shows of the call that just went away. */
  private resetCallView(): void {
    const { sink } = this.options;
    sink.localStream(null);
    sink.peers(() => new Map());
    sink.selfSocketId(null);
    sink.audioBlocked(false);
    sink.translating(false);
    sink.translationEnded(false);
  }
}
