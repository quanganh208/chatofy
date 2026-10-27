import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerEvent, SessionOptions } from '@chatofy/types';
import type { ConferenceCascadeLeg, TranslateSocketHandlers } from '@chatofy/realtime-client';

/**
 * The browser wiring of the meeting speaker leg, against the REAL shared leg and
 * session, with stand-ins only for what the browser provides: the track, the
 * audio graph, and the translate socket.
 *
 * The stand-in graph does what a browser does with a disabled track — it keeps
 * running and delivers silence — so "the leg hears nothing while muted" is
 * proven on the samples, not on a flag.
 */

/** What the fake translate socket recorded. */
interface Sent {
  type: string;
  payload?: string;
  turnId?: string;
  options?: SessionOptions;
}

const { sockets, legs } = vi.hoisted(() => ({
  sockets: [] as {
    url: string;
    token: string;
    sent: Sent[];
    emit: (e: ServerEvent) => void;
    drop: (code: number) => void;
  }[],
  legs: [] as {
    leg: ConferenceCascadeLeg;
    pause: ReturnType<typeof vi.fn>;
    resume: ReturnType<typeof vi.fn>;
  }[],
}));

vi.mock('@chatofy/realtime-client', async (importOriginal) => {
  const original = await importOriginal<typeof import('@chatofy/realtime-client')>();
  class FakeTranslateSocket {
    readonly sent: Sent[] = [];
    constructor(
      readonly url: string,
      private readonly handlers: TranslateSocketHandlers,
      readonly token: string,
    ) {
      sockets.push(this);
    }
    connect = () => Promise.resolve();
    startSession(options: SessionOptions, turnId: string): string {
      this.sent.push({ type: 'client.session.start', options, turnId });
      return turnId;
    }
    sendAudio(_id: string, _seq: number, _rate: number, payload: string): boolean {
      this.sent.push({ type: 'client.audio.frame', payload });
      return true;
    }
    speculate(): void {}
    endSession(): void {
      this.sent.push({ type: 'client.session.end' });
    }
    sendTurnMetrics(): void {}
    retranslateBlock(): void {}
    close(): void {}
    emit(event: ServerEvent): void {
      this.handlers.onEvent(event);
    }
    /** The server closes the socket. */
    drop(code: number): void {
      this.handlers.onClosed?.(code, '');
    }
  }
  return {
    ...original,
    TranslateSocket: FakeTranslateSocket,
    createConferenceCascadeLeg: (
      ...args: Parameters<typeof original.createConferenceCascadeLeg>
    ) => {
      const leg = original.createConferenceCascadeLeg(...args);
      legs.push({ leg, pause: vi.spyOn(leg, 'pause'), resume: vi.spyOn(leg, 'resume') });
      return leg;
    },
  };
});

const { createWebConferenceLeg } = await import('./conference-cascade-leg-web');

class FakeTrack {
  enabled = true;
  stopped = 0;
  readonly clones: FakeTrack[] = [];
  clone(): FakeTrack {
    const copy = new FakeTrack();
    copy.enabled = this.enabled;
    this.clones.push(copy);
    return copy;
  }
  stop(): void {
    this.stopped += 1;
  }
}

class FakeMediaStream {
  constructor(private readonly tracks: FakeTrack[]) {}
  getTracks = () => this.tracks;
  getAudioTracks = () => this.tracks;
}

/** The capture node the session reads blocks from; one per session. */
let nodes: FakeWorkletNode[];

class FakeWorkletNode {
  readonly port: { onmessage: ((event: { data: Float32Array }) => void) | null } = {
    onmessage: null,
  };
  track: FakeTrack | null = null;
  constructor() {
    nodes.push(this);
  }
  disconnect(): void {}
  /** One block of what the microphone hears; a disabled track delivers silence. */
  deliver(samples: Float32Array): void {
    const heard = this.track?.enabled ? samples : new Float32Array(samples.length);
    this.port.onmessage?.({ data: heard });
  }
}

class FakeAudioContext {
  readonly sampleRate = 48000;
  readonly currentTime = 0;
  readonly destination = {};
  readonly audioWorklet = { addModule: () => Promise.resolve() };
  createMediaStreamSource(stream: FakeMediaStream) {
    return {
      connect: (node: FakeWorkletNode) => {
        node.track = stream.getAudioTracks()[0] ?? null;
      },
      disconnect: () => {},
    };
  }
  close = () => Promise.resolve();
}

const speechBlock = () => Float32Array.from({ length: 1024 }, (_, i) => Math.sin(i / 3) * 0.25);

/** Enough speech to confirm a turn, then enough quiet to close it. */
function speak(): void {
  const node = nodes.at(-1)!;
  for (let i = 0; i < 8; i += 1) node.deliver(speechBlock());
  for (let i = 0; i < 30; i += 1) node.deliver(new Float32Array(1024));
}

const nonZeroFrames = () =>
  (sockets.at(-1)?.sent ?? []).filter(
    (e) =>
      e.type === 'client.audio.frame' &&
      atob(e.payload ?? '')
        .split('')
        .some((c) => c !== '\0'),
  );

/** Let the leg's start — token, worklet, microphone, socket — run to completion. */
const settle = async () => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};

function setup({ muted = false } = {}) {
  const original = new FakeTrack();
  original.enabled = !muted;
  const conference = { readyState: WebSocket.OPEN, send: vi.fn() };
  const translating: boolean[] = [];
  const ended: string[] = [];
  const leg = createWebConferenceLeg({
    ws: conference as unknown as WebSocket,
    stream: new FakeMediaStream([original]) as unknown as MediaStream,
    sourceLanguage: 'vi',
    roomLanguages: ['en'],
    translateSocketUrl: 'wss://api.example/ws/translate',
    getToken: () => Promise.resolve('tok'),
    muted,
    onTranslatingChange: (active) => translating.push(active),
    onEnded: (reason) => ended.push(reason),
  });
  return { leg, original, conference, translating, ended, shared: legs.at(-1)! };
}

beforeEach(() => {
  sockets.length = 0;
  legs.length = 0;
  nodes = [];
  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.stubGlobal('AudioWorkletNode', FakeWorkletNode);
  vi.stubGlobal('MediaStream', FakeMediaStream);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createWebConferenceLeg', () => {
  it('captures a clone of the published track, over the translate URL it was given', async () => {
    const { leg, original } = setup();
    await leg.start();
    await settle();

    expect(original.clones).toHaveLength(1);
    expect(nodes.at(-1)?.track).toBe(original.clones[0]);
    expect(sockets.at(-1)).toMatchObject({ url: 'wss://api.example/ws/translate', token: 'tok' });
    leg.stop();
  });

  it('joined muted: hears nothing; unmuted: the clone is live and the leg gets speech', async () => {
    const { leg, original, shared } = setup({ muted: true });
    expect(shared.pause).toHaveBeenCalled();
    await leg.start();
    await settle();

    const clone = original.clones[0]!;
    expect(clone.enabled).toBe(false);
    speak();
    expect(sockets.at(-1)?.sent.some((e) => e.type === 'client.session.start')).toBe(false);

    leg.setMuted(false);
    expect(clone.enabled).toBe(true);
    expect(original.enabled).toBe(true);
    expect(shared.resume).toHaveBeenCalled();
    speak();
    await settle();
    const socket = sockets.at(-1)!;
    const start = socket.sent.find((e) => e.type === 'client.session.start');
    expect(start).toBeDefined();
    // Audio leaves once the server has named the turn.
    socket.emit({
      type: 'server.session.ready',
      sessionId: crypto.randomUUID(),
      turnId: start!.turnId!,
    });
    await settle();
    expect(nonZeroFrames().length).toBeGreaterThan(0);
    leg.stop();
  });

  it('mute disables the clone and the published track and pauses the leg', async () => {
    const { leg, original, shared } = setup();
    await leg.start();
    await settle();

    leg.setMuted(true);
    expect(original.clones[0]!.enabled).toBe(false);
    expect(original.enabled).toBe(false);
    expect(shared.pause).toHaveBeenCalled();
    expect(shared.leg.muted).toBe(true);
    speak();
    expect(sockets.at(-1)?.sent.some((e) => e.type === 'client.session.start')).toBe(false);
    leg.stop();
  });

  it('stop releases the clone and never the published track', async () => {
    const { leg, original } = setup();
    await leg.start();
    await settle();

    leg.stop();
    expect(original.clones[0]!.stopped).toBeGreaterThan(0);
    expect(original.stopped).toBe(0);
  });

  it('leave releases the clone and never the published track', async () => {
    const { leg, original } = setup();
    await leg.start();
    await settle();

    await leg.leave();
    expect(original.clones[0]!.stopped).toBeGreaterThan(0);
    expect(original.stopped).toBe(0);
  });

  it('relays subtitles over the conference socket, and reports the turn open and closed', async () => {
    const { leg, conference, translating } = setup();
    await leg.start();
    await settle();
    speak();
    await settle();

    const socket = sockets.at(-1)!;
    const sessionId = crypto.randomUUID();
    socket.emit({ type: 'server.session.ready', sessionId, turnId: 'ignored' });
    socket.emit({
      type: 'server.transcript.delta',
      sessionId,
      committed: 'xin chào',
      pending: '',
      reanchors: 0,
      speaker: 'speaker_a',
      languagePair: { source: 'vi', target: 'en' },
    });
    const events = conference.send.mock.calls.map(
      ([raw]) => JSON.parse(raw as string) as { event: string; data: Record<string, unknown> },
    );
    expect(events.at(-1)?.event).toBe('conference.translation.broadcast');
    expect(events.at(-1)?.data.subtitle).toMatchObject({ sourceText: 'xin chào', isFinal: false });
    expect(translating).toEqual([true]);

    leg.stop();
    expect(translating).toEqual([true, false]);
  });

  it('passes translation ending for good on to the call', async () => {
    const { leg, ended } = setup();
    await leg.start();
    await settle();

    sockets.at(-1)!.drop(4410);
    await settle();

    expect(ended).toEqual(['refused']);
    leg.stop();
  });
});
