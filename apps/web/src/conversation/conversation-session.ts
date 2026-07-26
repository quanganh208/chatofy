import type { ServerEvent, TranslationDirection } from '@chatofy/types';
import type { TranslateSocket, TranslateSocketHandlers } from '@/clients/translate-socket';
import { CapturePump } from '@/audio/capture-pump';
import { PcmPlaybackQueue } from '@/audio/pcm-playback-queue';
import {
  base64ToPcm16,
  downsampleToPcm16,
  pcm16ToBase64,
  TARGET_SAMPLE_RATE,
} from '@/audio/pcm-resampler';
import type { ConversationStatus } from './conversation-status';

/** Samples the worklet posts per block, at the audio context's own rate. */
const WORKLET_BLOCK_SAMPLES = 1024;

/** How often the level meter may update. ~10 Hz instead of ~47. */
const LEVEL_UPDATE_MS = 100;

/** Everything one run of the conversation owns and must give back. */
interface LiveResources {
  socket?: TranslateSocket;
  stream?: MediaStream;
  context?: AudioContext;
  node?: AudioWorkletNode;
  playback?: PcmPlaybackQueue;
  pump?: CapturePump;
}

export interface ConversationSessionDeps {
  openMicrophone: () => Promise<MediaStream>;
  createAudioContext: () => AudioContext;
  /** `AudioWorkletNode` is a global, so it has to arrive from outside to be faked. */
  createWorkletNode: (context: AudioContext) => AudioWorkletNode;
  createSocket: (handlers: TranslateSocketHandlers) => TranslateSocket;
  workletUrl: string;
}

export interface ConversationSessionListeners {
  onStatus: (status: ConversationStatus) => void;
  onLevel: (level: number) => void;
  onMuted: (muted: boolean) => void;
  onError: (message: string | null) => void;
  onEchoHeard: () => void;
  /** Straight to the reducer that owns the transcript. */
  onServerEvent: (event: ServerEvent) => void;
  /** Clear the transcript for a conversation that is starting over. */
  onReset: () => void;
}

/**
 * One hands-free conversation over `/ws/translate`: microphone, socket,
 * playback and the state that ties them together.
 *
 * The turn boundary is decided by {@link CapturePump}, which owns the whole
 * policy and is unit-tested; this class is the wiring between it, the socket and
 * playback. Anything resembling a decision about when to listen belongs there,
 * not here.
 *
 * The one invariant worth restating: the microphone is re-armed only once the
 * turn has BOTH ended server-side AND finished playing. Releasing on either
 * alone reopens it into our own loudspeaker, and two people sharing one phone
 * then get a loop where the app translates itself forever.
 */
export class ConversationSession {
  /**
   * Identifies the current `start()` run. `stop()` bumps it so a start still
   * awaiting the microphone abandons the one it is about to be handed instead
   * of publishing it to a session the caller believes is torn down.
   */
  private generation = 0;
  private live: LiveResources | null = null;
  private direction: TranslationDirection = 'vi_to_en';
  /** Server-assigned id for the turn in flight; null between turns. */
  private sessionId: string | null = null;
  private sequence = 0;
  /** Blocks captured before `server.session.ready` arrived. */
  private pending: Int16Array[] = [];
  /** Set when the server closes the turn; half of the re-arm condition. */
  private turnEnded = false;
  private lastLevelAt = 0;

  constructor(
    private readonly deps: ConversationSessionDeps,
    private readonly listeners: ConversationSessionListeners,
    /**
     * Read at each `start()` rather than captured once, because the caller may
     * flip it between runs — it exists to be toggled while measuring echo.
     */
    private readonly isFullDuplex: () => boolean = () => false,
  ) {}

  get isRunning(): boolean {
    return this.live !== null;
  }

  async start(direction: TranslationDirection): Promise<void> {
    // Catches a start issued while one is already running: without it the
    // transcript resets in front of the speaker and a second microphone opens
    // alongside the first, sending audio in parallel.
    //
    // A double tap during startup is a different case and a different mechanism:
    // both calls get past here, and the generation counter below decides which
    // one survives.
    if (this.isRunning) return;

    const generation = ++this.generation;
    const isStale = () => this.generation !== generation;

    this.listeners.onError(null);
    this.listeners.onReset();
    this.listeners.onStatus('connecting');
    this.direction = direction;

    // Held locally until every await has cleared, so a teardown mid-startup
    // releases them instead of leaking a live microphone.
    const local: LiveResources = {};

    try {
      local.stream = await this.deps.openMicrophone();
      if (isStale()) return this.releaseResources(local);

      local.context = this.deps.createAudioContext();
      await local.context.audioWorklet.addModule(this.deps.workletUrl);
      if (isStale()) return this.releaseResources(local);

      local.socket = this.deps.createSocket({
        onEvent: (event) => this.handleServerEvent(event),
        onError: (message) => this.listeners.onError(message),
        onClosed: () => {
          // Without a socket the conversation cannot continue, and leaving it
          // "listening" would strand the microphone muted mid-turn.
          this.listeners.onError('Connection to the translator dropped');
          this.stop();
        },
      });
      await local.socket.connect();
      if (isStale()) return this.releaseResources(local);

      const socket = local.socket;
      const context = local.context;

      local.playback = new PcmPlaybackQueue(context, () => this.armIfTurnComplete());
      const pump = new CapturePump(
        {
          onTurnOpen: (preRoll) => {
            this.listeners.onStatus('hearing-speech');
            this.sequence = 0;
            this.sessionId = null;
            this.pending = [...preRoll];
            socket.startSession(this.direction);
          },
          onAudio: (block) => this.sendBlock(block),
          // A suspected pause: let the server get a head start on the text.
          onProbableEnd: () => socket.speculate(),
          onTurnClose: () => {
            this.listeners.onStatus('translating');
            this.listeners.onMuted(true);
            socket.endSession();
          },
          onLevel: (value) => {
            const now = Date.now();
            if (now - this.lastLevelAt < LEVEL_UPDATE_MS) return;
            this.lastLevelAt = now;
            this.listeners.onLevel(value);
          },
          onEchoHeard: () => this.listeners.onEchoHeard(),
        },
        Math.max(1, Math.floor(WORKLET_BLOCK_SAMPLES / (context.sampleRate / TARGET_SAMPLE_RATE))),
        this.isFullDuplex(),
      );
      local.pump = pump;

      const node = this.deps.createWorkletNode(context);
      local.node = node;
      node.port.onmessage = (message: MessageEvent<Float32Array>) => {
        pump.push(downsampleToPcm16(message.data, context.sampleRate));
      };
      context.createMediaStreamSource(local.stream).connect(node);

      this.live = local;
      this.listeners.onStatus('listening');
    } catch (err) {
      this.releaseResources(local);
      this.stop();
      this.listeners.onError(
        err instanceof Error ? err.message : 'Could not start the conversation',
      );
    }
  }

  /**
   * End the run: give back its resources AND clear the state a new run would
   * otherwise inherit.
   *
   * Deliberately does not clear the error. `onClosed` reports the dropped
   * connection and then calls this, and a user returned to idle with no
   * explanation has been told nothing at all.
   */
  stop(): void {
    this.generation += 1;
    const live = this.live;
    this.live = null;
    this.releaseResources(live ?? {});

    this.sessionId = null;
    this.sequence = 0;
    this.pending = [];
    this.turnEnded = false;

    this.listeners.onStatus('idle');
    this.listeners.onLevel(0);
    this.listeners.onMuted(false);
  }

  /**
   * Give back exactly the resources handed in, and nothing else.
   *
   * Kept apart from {@link stop} because a start that has gone stale must let go
   * of what it built without touching shared state: the run that replaced it is
   * already using that state, and blanking its session id there would leave the
   * microphone open, the meter moving, and not one byte reaching the server.
   */
  private releaseResources(r: Partial<LiveResources>): void {
    r.socket?.close();
    r.node?.disconnect();
    if (r.node) r.node.port.onmessage = null;
    r.playback?.stop();
    r.stream?.getTracks().forEach((track) => track.stop());
    void r.context?.close().catch(() => {});
    r.pump?.reset();
  }

  /**
   * Listen again, but only when the turn is finished in both senses. Called
   * from the server's end-of-turn and from playback draining, because either
   * can be the last to happen.
   */
  private armIfTurnComplete(): void {
    if (!this.turnEnded) return;
    if (this.live?.playback?.isPlaying) return;
    this.turnEnded = false;
    this.live?.pump?.armNextTurn();
    this.listeners.onMuted(false);
    this.listeners.onStatus('listening');
  }

  private sendBlock(block: Int16Array): void {
    const sessionId = this.sessionId;
    if (!sessionId) {
      // The handshake is still in flight; hold the audio rather than drop it.
      this.pending.push(block);
      return;
    }
    this.live?.socket?.sendAudio(
      sessionId,
      this.sequence++,
      TARGET_SAMPLE_RATE,
      pcm16ToBase64(block),
    );
  }

  /**
   * Send everything held during the handshake.
   *
   * Detached before the loop, not during it: {@link sendBlock} pushes back onto
   * `pending` whenever the id is still missing, so iterating the live array
   * would hand the same blocks to the next flush with an advancing sequence —
   * and an advancing sequence is exactly what the server's replay guard lets
   * through. The utterance would double with nothing anywhere reporting it.
   */
  private flushPending(): void {
    const held = this.pending;
    this.pending = [];
    for (const block of held) this.sendBlock(block);
  }

  private handleServerEvent(event: ServerEvent): void {
    // Every event goes to the reducer; the switch below is transport and
    // playback, which the reducer deliberately knows nothing about.
    this.listeners.onServerEvent(event);

    switch (event.type) {
      case 'server.session.ready':
        this.sessionId = event.sessionId;
        this.flushPending();
        break;

      case 'server.audio.frame':
        this.listeners.onStatus('playing');
        this.live?.playback?.enqueue(base64ToPcm16(event.frame.payload), event.frame.sampleRate);
        break;

      case 'server.session.ended':
        this.sessionId = null;
        this.sequence = 0;
        this.turnEnded = true;
        // Usually a no-op: audio is still playing, and the microphone must stay
        // shut until it has drained.
        this.armIfTurnComplete();
        break;

      case 'server.error':
        this.listeners.onError(event.message);
        break;

      default:
        break;
    }
  }
}
