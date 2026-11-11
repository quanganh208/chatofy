import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SocketResumeRegistry, resumeKeyFrom } from './socket-resume-registry';

describe('SocketResumeRegistry', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const make = () => {
    const expired: object[] = [];
    const registry = new SocketResumeRegistry<object>(30_000, (s) =>
      expired.push(s),
    );
    return { registry, expired };
  };

  it('returns the still-open socket a reconnect replaces', () => {
    const { registry } = make();
    const a = {};
    const b = {};
    expect(registry.claim('u1', 'key-123456', a)).toBeNull();
    expect(registry.claim('u1', 'key-123456', b)).toEqual({
      previous: a,
      parked: false,
    });
  });

  it('never joins one user to another user’s conversation', () => {
    const { registry } = make();
    registry.claim('u1', 'key-123456', {});
    expect(registry.claim('u2', 'key-123456', {})).toBeNull();
  });

  it('parks a cleanly closed socket and hands it to a reconnect within the window', () => {
    const { registry, expired } = make();
    const a = {};
    registry.claim('u1', 'key-123456', a);
    expect(registry.release(a)).toBe(true);
    vi.advanceTimersByTime(5_000);
    expect(registry.claim('u1', 'key-123456', {})).toEqual({
      previous: a,
      parked: true,
    });
    vi.advanceTimersByTime(60_000);
    expect(expired).toEqual([]);
  });

  it('expires a parked socket nobody reclaimed', () => {
    const { registry, expired } = make();
    const a = {};
    registry.claim('u1', 'key-123456', a);
    registry.release(a);
    vi.advanceTimersByTime(30_000);
    expect(expired).toEqual([a]);
    expect(registry.claim('u1', 'key-123456', {})).toBeNull();
  });

  it('does not park a socket that was already replaced', () => {
    const { registry } = make();
    const a = {};
    registry.claim('u1', 'key-123456', a);
    registry.claim('u1', 'key-123456', {});
    expect(registry.release(a)).toBe(false);
  });

  it('does not park a socket that never claimed a key', () => {
    expect(make().registry.release({})).toBe(false);
  });
});

describe('resumeKeyFrom', () => {
  it('reads a well-formed key off the upgrade URL', () => {
    expect(resumeKeyFrom({ url: '/ws/translate?resume=9f1c2d3e-aaaa' })).toBe(
      '9f1c2d3e-aaaa',
    );
  });

  it('ignores a missing, short or malformed key', () => {
    expect(resumeKeyFrom({ url: '/ws/translate' })).toBeUndefined();
    expect(resumeKeyFrom({ url: '/ws/translate?resume=abc' })).toBeUndefined();
    expect(
      resumeKeyFrom({ url: '/ws/translate?resume=a%20b%20c%20d%20e' }),
    ).toBeUndefined();
    expect(resumeKeyFrom({})).toBeUndefined();
    expect(resumeKeyFrom(null)).toBeUndefined();
  });
});
