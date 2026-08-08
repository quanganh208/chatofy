import { describe, expect, it } from 'vitest';
import { LiveSession } from './live-session.js';
import type { LiveTranslateSocketHandlers } from '../transport/live-translate-socket.js';
import type { LiveServerEvent, LiveClientEvent } from '@chatofy/types';
import { pcm16ToBase64 } from '../audio/pcm-resampler.js';

/** A socket that records what was sent and lets a test push events back. */
class FakeSocket {
  readonly sent: LiveClientEvent[] = [];
  closed = 0;
  constructor(readonly handlers: LiveTranslateSocketHandlers) {}
  connect(): Promise<void> {
    return Promise.resolve();
  }
  send(event: LiveClientEvent): void {
    this.sent.push(event);
  }
  start(direction: 'vi_to_en' | 'en_to_vi'): void {
    this.send({ type: 'client.live.start', direction });
  }
  sendAudio(sequence: number, sampleRate: number, payload: string): void {
    this.send({
      type: 'client.live.audio',
      frame: {
        sessionId: 'live',
        encoding: 'pcm16',
        sampleRate,
        sequence,
        timestamp: 0,
        payload,
      },
    });
  }
  stop(): void {
    this.send({ type: 'client.live.stop' });
  }
  close(): void {
    this.closed += 1;
  }
  emit(event: LiveServerEvent): void {
    this.handlers.onEvent(event);
  }
}

function harness() {
  let socket: FakeSocket | null = null;
  const played: { length: number; rate: number }[] = [];
  const seen = {
    source: [] as [string, string][],
    target: [] as string[],
    ended: [] as string[],
    errors: [] as string[],
  };
  const session = new LiveSession(
    {
      createSocket: (handlers) => {
        socket = new FakeSocket(handlers);
        return socket as unknown as never;
      },
      play: (samples, rate) => played.push({ length: samples.length, rate }),
    },
    {
      onSourceText: (delta, lang) => seen.source.push([delta, lang]),
      onTargetText: (delta) => seen.target.push(delta),
      onEnded: (reason) => seen.ended.push(reason),
      onError: (message) => seen.errors.push(message),
    },
  );
  return {
    session,
    played,
    seen,
    get socket(): FakeSocket {
      if (!socket) throw new Error('socket not created');
      return socket;
    },
  };
}

/** Ready is what the contract says a client waits for before sending audio. */
async function started(h: ReturnType<typeof harness>) {
  await h.session.start('vi_to_en');
  h.socket.emit({ type: 'server.live.ready', sessionId: 's1' });
}

describe('LiveSession', () => {
  it('opens with the direction it was given', async () => {
    const h = harness();
    await h.session.start('en_to_vi');
    expect(h.socket.sent[0]).toEqual({ type: 'client.live.start', direction: 'en_to_vi' });
  });

  /**
   * The regression that would silently reintroduce a truncated translation.
   *
   * The turn path's `CapturePump` holds silent blocks back. This path must not:
   * the backend has no endpoint event and reads trailing quiet as the end of an
   * utterance, so a gate here would cut every translation short.
   */
  it('sends silent blocks like any other', async () => {
    const h = harness();
    await started(h);

    h.session.pushBlock(new Int16Array(160).fill(4000));
    h.session.pushBlock(new Int16Array(160)); // pure silence
    h.session.pushBlock(new Int16Array(160)); // still silent

    const audio = h.socket.sent.filter((e) => e.type === 'client.live.audio');
    expect(audio).toHaveLength(3);
    expect(audio.map((e) => e.frame.sequence)).toEqual([0, 1, 2]);
    expect(audio[1]!.frame.payload).toBe(pcm16ToBase64(new Int16Array(160)));
  });

  /**
   * Reported from real use: "the first sentence always lags, the rest are
   * fine." Capture is wired the instant the caller opens the microphone, but the
   * upstream takes a moment to dial, and a user presses Start and talks
   * immediately. These blocks used to be dropped, so the opening of the first
   * utterance was thrown away and the model answered a truncated sentence —
   * once per conversation, which is exactly the shape of the complaint.
   */
  it('holds audio captured before ready, then sends it in order', async () => {
    const h = harness();
    await h.session.start('vi_to_en');

    h.session.pushBlock(new Int16Array(160).fill(1000));
    h.session.pushBlock(new Int16Array(160).fill(2000));
    expect(h.socket.sent.filter((e) => e.type === 'client.live.audio')).toHaveLength(0);

    h.socket.emit({ type: 'server.live.ready', sessionId: 's1' });

    const audio = h.socket.sent.filter((e) => e.type === 'client.live.audio');
    expect(audio).toHaveLength(2);
    expect(audio.map((e) => e.frame.sequence)).toEqual([0, 1]);
    // In capture order, and the earliest block first — it is the start of the
    // sentence, not a straggler.
    expect(audio[0]!.frame.payload).toBe(pcm16ToBase64(new Int16Array(160).fill(1000)));
  });

  it('keeps sending directly once ready, without re-buffering', async () => {
    const h = harness();
    await started(h);
    h.session.pushBlock(new Int16Array(160).fill(1000));
    expect(h.socket.sent.filter((e) => e.type === 'client.live.audio')).toHaveLength(1);
  });

  it('drops the oldest held blocks rather than growing without bound', async () => {
    const h = harness();
    await h.session.start('vi_to_en');
    // A session that never connects must not hold audio for ever.
    for (let i = 0; i < 300; i += 1) h.session.pushBlock(new Int16Array(160).fill(i));
    h.socket.emit({ type: 'server.live.ready', sessionId: 's1' });

    const audio = h.socket.sent.filter((e) => e.type === 'client.live.audio');
    expect(audio).toHaveLength(250);
    // The tail survived: it is the part still being spoken.
    expect(audio.at(-1)!.frame.payload).toBe(pcm16ToBase64(new Int16Array(160).fill(299)));
  });

  it('discards held audio after stop', async () => {
    const h = harness();
    await h.session.start('vi_to_en');
    h.session.pushBlock(new Int16Array(160).fill(1000));
    h.session.dispose();
    h.session.pushBlock(new Int16Array(160).fill(2000));
    expect(h.socket.sent.filter((e) => e.type === 'client.live.audio')).toHaveLength(0);
  });

  it('plays translated audio at the rate the backend sent', async () => {
    const h = harness();
    await started(h);

    // 24 kHz is the backend's rate; capture is 16 kHz. A frame played at the
    // capture rate would come out a third too slow.
    h.socket.emit({
      type: 'server.live.audio',
      frame: {
        sessionId: 's1',
        encoding: 'pcm16',
        sampleRate: 24000,
        sequence: 0,
        timestamp: 0,
        payload: pcm16ToBase64(new Int16Array(480).fill(1234)),
      },
    });

    expect(h.played).toEqual([{ length: 480, rate: 24000 }]);
  });

  it('routes the two transcript channels apart, keeping the detected language', async () => {
    const h = harness();
    await started(h);

    h.socket.emit({
      type: 'server.live.transcript',
      sessionId: 's1',
      channel: 'source',
      delta: 'Tuy nhiên',
      lang: 'vi',
    });
    h.socket.emit({
      type: 'server.live.transcript',
      sessionId: 's1',
      channel: 'target',
      delta: 'However',
      lang: 'en',
    });

    expect(h.seen.source).toEqual([['Tuy nhiên', 'vi']]);
    expect(h.seen.target).toEqual(['However']);
  });

  it('stops sending after stop, and closes only when the server has ended', async () => {
    const h = harness();
    await started(h);
    h.session.stop();

    // Closing on `stop()` would drop translated audio still in flight — the
    // backend trails the speaker by seconds by design.
    expect(h.socket.closed).toBe(0);
    h.session.pushBlock(new Int16Array(160).fill(1000));
    expect(h.socket.sent.filter((e) => e.type === 'client.live.audio')).toHaveLength(0);

    h.socket.emit({ type: 'server.live.ended', sessionId: 's1', reason: 'client_stopped' });
    expect(h.socket.closed).toBe(1);
    expect(h.seen.ended).toEqual(['client_stopped']);
  });

  it('reports a server error without ending the session', async () => {
    const h = harness();
    await started(h);
    h.socket.emit({ type: 'server.live.error', code: 'upstream_error', message: 'reset' });

    expect(h.seen.errors).toEqual(['upstream_error: reset']);
    expect(h.session.state).toBe('live');
  });

  it('reports an upstream close the client did not ask for', async () => {
    const h = harness();
    await started(h);
    h.socket.emit({ type: 'server.live.ended', sessionId: 's1', reason: 'token expired' });

    expect(h.seen.ended).toEqual(['token expired']);
    expect(h.session.state).toBe('stopped');
  });

  it('ignores a second start while one is live', async () => {
    const h = harness();
    await started(h);
    await h.session.start('vi_to_en');
    expect(h.socket.sent.filter((e) => e.type === 'client.live.start')).toHaveLength(1);
  });

  /**
   * `dispose()` is how a caller ends a conversation it is REPLACING, as opposed
   * to one it is letting finish — and a caller only ever has both at once
   * because `stop()` deliberately leaves the first socket open for trailing
   * audio. What makes that safe is this: disposing closes the socket at once,
   * and a closed socket delivers nothing (see `live-translate-socket.spec.ts`).
   *
   * Untested, that chain broke where it was thinnest. The web hook replaced a
   * conversation without disposing the old one, and the old one's late
   * `server.live.ended` tore the microphone out of the new one.
   */
  describe('dispose', () => {
    it('closes the socket at once rather than waiting for the server', async () => {
      const h = harness();
      await started(h);

      h.session.dispose();

      // Unlike `stop()`, which waits for `server.live.ended`. There is no
      // trailing audio worth keeping for a conversation being thrown away.
      expect(h.socket.closed).toBe(1);
      expect(h.session.state).toBe('stopped');
    });

    it('sends nothing further, including audio already captured', async () => {
      const h = harness();
      await started(h);
      h.session.dispose();

      h.session.pushBlock(new Int16Array(160).fill(1000));
      h.session.stop();

      expect(h.socket.sent.filter((e) => e.type === 'client.live.audio')).toHaveLength(0);
      expect(h.socket.sent.filter((e) => e.type === 'client.live.stop')).toHaveLength(0);
    });

    it('closes a session disposed while it was still connecting', async () => {
      const h = harness();
      // No `ready`: the socket is up but the upstream has not answered, which is
      // where a user who starts and immediately restarts lands.
      await h.session.start('vi_to_en');
      h.session.pushBlock(new Int16Array(160).fill(1000));

      h.session.dispose();

      expect(h.socket.closed).toBe(1);
      // The held audio goes with it — it belongs to the conversation being
      // abandoned, and flushing it into the next one would put someone's words
      // in a session they did not say them to.
      h.socket.emit({ type: 'server.live.ready', sessionId: 's1' });
      expect(h.socket.sent.filter((e) => e.type === 'client.live.audio')).toHaveLength(0);
    });
  });
});
