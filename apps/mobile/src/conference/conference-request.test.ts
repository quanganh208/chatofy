import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConferenceRequestError, request, type SignalSocket } from './conference-request.ts';

type Listener = (evt: { data: unknown }) => void;

/**
 * A socket shaped like the gateway: it answers each request on the same event
 * name with no correlation id, after a delay, in the order requests arrived.
 */
class FakeGatewaySocket implements SignalSocket {
  readonly sent: { event: string; data: unknown }[] = [];
  private readonly listeners = new Set<Listener>();
  private readonly answer: (event: string, data: unknown) => unknown;

  constructor(answer: (event: string, data: unknown) => unknown) {
    this.answer = answer;
  }

  send(raw: string): void {
    const msg = JSON.parse(raw) as { event: string; data: unknown };
    this.sent.push(msg);
    setTimeout(() => this.emit(msg.event, this.answer(msg.event, msg.data)), 5);
  }

  addEventListener(_type: 'message', listener: Listener): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: 'message', listener: Listener): void {
    this.listeners.delete(listener);
  }

  listenerCount(): number {
    return this.listeners.size;
  }

  private emit(event: string, data: unknown): void {
    for (const l of [...this.listeners]) l({ data: JSON.stringify({ event, data }) });
  }
}

const consumeAnswer = (event: string, data: unknown) =>
  event === 'conference.consume'
    ? { id: `consumer-of-${(data as { producerId: string }).producerId}` }
    : { ok: true };

describe('request', () => {
  it('gives two concurrent consumes of two producers two distinct consumers', async () => {
    const ws = new FakeGatewaySocket(consumeAnswer);
    const [audio, video] = await Promise.all([
      request(ws, 'conference.consume', { producerId: 'audio' }),
      request(ws, 'conference.consume', { producerId: 'video' }),
    ]);
    assert.deepEqual(audio, { id: 'consumer-of-audio' });
    assert.deepEqual(video, { id: 'consumer-of-video' });
    assert.equal(ws.listenerCount(), 0);
  });

  it('sends the next same-name request only after the previous reply', async () => {
    const ws = new FakeGatewaySocket(consumeAnswer);
    const first = request(ws, 'conference.consume', { producerId: 'a' });
    const second = request(ws, 'conference.consume', { producerId: 'b' });
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(ws.sent.length, 1);
    await first;
    await second;
    assert.deepEqual(
      ws.sent.map((m) => (m.data as { producerId: string }).producerId),
      ['a', 'b'],
    );
  });

  it('does not hold back a request with a different name', async () => {
    const ws = new FakeGatewaySocket(consumeAnswer);
    void request(ws, 'conference.consume', { producerId: 'a' });
    void request(ws, 'conference.consumer.resume', { consumerId: 'x' });
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(
      ws.sent.map((m) => m.event),
      ['conference.consume', 'conference.consumer.resume'],
    );
    await new Promise((r) => setTimeout(r, 20));
  });

  it('rejects a refusal with its code and lets the next request through', async () => {
    let calls = 0;
    const ws = new FakeGatewaySocket(() =>
      ++calls === 1 ? { error: 'peer_not_found' } : { id: 'ok' },
    );
    const refused = request(ws, 'conference.consume', { producerId: 'gone' });
    const next = request(ws, 'conference.consume', { producerId: 'live' });
    await assert.rejects(refused, (err: unknown) => {
      assert.ok(err instanceof ConferenceRequestError);
      assert.equal(err.code, 'peer_not_found');
      return true;
    });
    assert.deepEqual(await next, { id: 'ok' });
  });

  it('times out from when the request is sent, then frees the chain', async () => {
    let calls = 0;
    const ws = new FakeGatewaySocket(() => undefined);
    // Swallow the first reply so it times out; answer the second normally.
    const realSend = ws.send.bind(ws);
    ws.send = (raw: string) => {
      if (++calls === 1) {
        ws.sent.push(JSON.parse(raw) as { event: string; data: unknown });
        return;
      }
      realSend(raw);
    };
    const lost = request(ws, 'conference.consume', { producerId: 'a' }, 20);
    const next = request(ws, 'conference.consume', { producerId: 'b' }, 50);
    await assert.rejects(lost, /Timeout waiting for conference.consume/);
    assert.equal(await next, undefined);
  });
});
