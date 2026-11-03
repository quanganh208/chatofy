import { afterEach, describe, expect, it, vi } from 'vitest';
import { HeldClosingVoices, closerVoice } from './held-closing-voices';
import type { StreamSocket } from './stream-socket';
import type { TurnSession } from './turn-session';

const A = [1, 0];
const B = [0, 1];
const socket = {} as StreamSocket;
const turn = () => ({}) as TurnSession;

afterEach(() => vi.useRealTimers());

describe('closerVoice', () => {
  it("takes the next turn's voice when the piece is closer to it", () => {
    expect(closerVoice({ own: [0.2, 0.9], rest: A }, B)).toBe(B);
  });

  it("keeps its own turn's voice otherwise", () => {
    expect(closerVoice({ own: [0.9, 0.2], rest: A }, B)).toBe(A);
  });
});

describe('HeldClosingVoices', () => {
  it('sends its fallback at once when no later turn is open', () => {
    const send = vi.fn();
    new HeldClosingVoices().hold(
      socket,
      { own: B, rest: A, fallback: A, send },
      undefined,
    );
    expect(send).toHaveBeenCalledWith(A);
  });

  it("waits for the next turn's own voice, then sends the closer one", () => {
    const closings = new HeldClosingVoices();
    const send = vi.fn();
    const next = turn();
    closings.hold(
      socket,
      { own: [0.1, 0.9], rest: A, fallback: A, send },
      next,
    );
    expect(send).not.toHaveBeenCalled();

    closings.heard(socket, next, B);
    expect(send).toHaveBeenCalledExactlyOnceWith(B);
  });

  it('is not decided by a turn other than the one it waits for', () => {
    const closings = new HeldClosingVoices();
    const send = vi.fn();
    closings.hold(socket, { own: B, rest: A, fallback: A, send }, turn());
    closings.heard(socket, turn(), B);
    expect(send).not.toHaveBeenCalled();
  });

  it("decides at once when the next turn's voice is already known", () => {
    const closings = new HeldClosingVoices();
    const send = vi.fn();
    const next = turn();
    closings.heard(socket, next, B);
    closings.hold(
      socket,
      { own: [0.1, 0.9], rest: A, fallback: A, send },
      next,
    );
    expect(send).toHaveBeenCalledWith(B);
  });

  it("falls back to its own turn's voice when the next turn never speaks", () => {
    vi.useFakeTimers();
    const closings = new HeldClosingVoices(1000);
    const send = vi.fn();
    closings.hold(socket, { own: B, rest: A, fallback: A, send }, turn());
    vi.advanceTimersByTime(1000);
    expect(send).toHaveBeenCalledExactlyOnceWith(A);
  });

  it('sends a waiting closing before holding the next one', () => {
    const closings = new HeldClosingVoices();
    const first = vi.fn();
    closings.hold(
      socket,
      { own: B, rest: A, fallback: A, send: first },
      turn(),
    );
    closings.hold(
      socket,
      { own: B, rest: A, fallback: A, send: vi.fn() },
      turn(),
    );
    expect(first).toHaveBeenCalledWith(A);
  });

  it('sends nothing once the connection is dropped', () => {
    vi.useFakeTimers();
    const closings = new HeldClosingVoices(1000);
    const send = vi.fn();
    const next = turn();
    closings.hold(socket, { own: B, rest: A, fallback: A, send }, next);
    closings.drop(socket);
    closings.heard(socket, next, B);
    vi.advanceTimersByTime(1000);
    expect(send).not.toHaveBeenCalled();
  });
});
