import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TURN_QUIET_GAP_MS } from './subtitle-turn-accumulator';
import { wireTranslate } from './conference-translate-wiring';

/**
 * The translate leg against stand-in sockets and audio graph — enough to see
 * what it sends, and whether `stop()` actually lets go of the microphone.
 */

class FakeSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeSocket[] = [];
  readyState = FakeSocket.CONNECTING;
  sent: { event: string; data: Record<string, unknown> }[] = [];
  closedWith: number | undefined;
  constructor(readonly url = 'conference') {
    super();
    FakeSocket.instances.push(this);
  }
  send(raw: string) {
    this.sent.push(JSON.parse(raw) as { event: string; data: Record<string, unknown> });
  }
  close(code?: number) {
    this.closedWith = code;
    this.readyState = FakeSocket.CLOSED;
    this.dispatchEvent(new Event('close'));
  }
  open() {
    this.readyState = FakeSocket.OPEN;
    this.dispatchEvent(new Event('open'));
  }
  receive(payload: unknown) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(payload) }));
  }
}

const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });
let contexts: { close: ReturnType<typeof vi.fn> }[];

class FakeAudioContext {
  destination = {};
  close = vi.fn(() => Promise.resolve());
  constructor() {
    contexts.push(this);
  }
  createMediaStreamSource = () => node();
  createScriptProcessor = () => ({ ...node(), onaudioprocess: null });
  createGain = () => ({ ...node(), gain: { value: 1 } });
}

function setup() {
  const conference = new FakeSocket();
  conference.readyState = FakeSocket.OPEN;
  const translating: boolean[] = [];
  const handle = wireTranslate({
    translateUrl: 'ws://api',
    conferenceSocket: conference as unknown as WebSocket,
    stream: {} as MediaStream,
    sourceLanguage: 'vi',
    token: 'token',
    onTranslating: (active) => translating.push(active),
  });
  const translate = FakeSocket.instances.find((s) => s.url.endsWith('/ws/translate'));
  if (!translate) throw new Error('no translate socket opened');
  translate.open();
  return { conference, translate, handle, translating };
}

const transcript = (channel: 'source' | 'target', delta: string) => ({
  type: 'server.live.transcript',
  sessionId: 's',
  channel,
  delta,
  lang: channel === 'source' ? 'vi' : 'en',
});

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.instances = [];
  contexts = [];
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('AudioContext', FakeAudioContext);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('wireTranslate', () => {
  it('starts a vi→en live session', () => {
    const { translate } = setup();
    expect(translate.sent[0]?.data).toEqual({
      type: 'client.live.start',
      languagePair: { source: 'vi', target: 'en' },
    });
  });

  it('relays one turn as cumulative frames and a single final', () => {
    const { conference, translate } = setup();
    translate.receive(transcript('source', 'xin chào'));
    translate.receive(transcript('target', 'hello'));
    vi.advanceTimersByTime(TURN_QUIET_GAP_MS);

    const subtitles = conference.sent.map((m) => m.data.subtitle as Record<string, unknown>);
    expect(subtitles.map((s) => [s.sourceText, s.translatedText, s.isFinal])).toEqual([
      ['xin chào', '', false],
      ['xin chào', 'hello', false],
      ['xin chào', 'hello', true],
    ]);
    expect(new Set(subtitles.map((s) => s.turnId)).size).toBe(1);
    expect(subtitles[0]).toMatchObject({ sourceLanguage: 'vi', targetLanguage: 'en' });
  });

  it('stop() ends the session, closes the socket and releases the capture graph', () => {
    const { conference, translate, handle, translating } = setup();
    translate.receive(transcript('source', 'xin'));
    handle.stop();

    expect(translate.sent.at(-1)?.event).toBe('client.live.stop');
    expect(translate.closedWith).toBe(1000);
    expect(contexts[0]?.close).toHaveBeenCalledTimes(1);
    // The open turn is closed rather than abandoned, so the room keeps the line.
    expect(conference.sent.at(-1)?.data.subtitle).toMatchObject({ isFinal: true });
    expect(translating.at(-1)).toBe(false);
  });

  it('stop() is idempotent', () => {
    const { translate, handle } = setup();
    handle.stop();
    const sent = translate.sent.length;
    handle.stop();
    expect(translate.sent.length).toBe(sent);
    expect(contexts[0]?.close).toHaveBeenCalledTimes(1);
  });

  it('releases the capture graph when the server closes the socket', () => {
    const { translate } = setup();
    translate.close();
    expect(contexts[0]?.close).toHaveBeenCalledTimes(1);
  });
});
