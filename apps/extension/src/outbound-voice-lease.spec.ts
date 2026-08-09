import { describe, expect, it, vi } from 'vitest';
import { VOICE_LEASE_MS, VOICE_RENEW_MS, VoiceHold, VoiceLease } from './outbound-voice-lease';

/**
 * The user's own microphone, held shut by a document in another process.
 *
 * Every test here is a way that hold could outlive the thing holding it. The
 * feature failing is a user talking into a meeting nobody can hear, with the
 * track live and unmuted and no error anywhere.
 */

function leaseHarness() {
  const changes: boolean[] = [];
  let pending: { run: () => void; ms: number } | null = null;
  const lease = new VoiceLease({
    onChange: (mine) => changes.push(mine),
    setTimer: (run, ms) => {
      pending = { run, ms };
      return 1 as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: () => {
      pending = null;
    },
  });
  return {
    lease,
    changes,
    expire: () => {
      const run = pending?.run;
      pending = null;
      run?.();
    },
    get armedFor() {
      return pending?.ms ?? null;
    },
  };
}

describe('VoiceLease', () => {
  it('starts with the meeting hearing the user', () => {
    const h = leaseHarness();

    expect(h.lease.mine).toBe(true);
    expect(h.changes).toEqual([]);
  });

  it('takes the voice away on the first renewal and reports it once', () => {
    // Renewed once a second for the length of a meeting. Reporting every one of
    // those would be a gain ramp per second on every composed track.
    const h = leaseHarness();

    h.lease.renew();
    h.lease.renew();
    h.lease.renew();

    expect(h.lease.mine).toBe(false);
    expect(h.changes).toEqual([false]);
  });

  it('gives the voice back when the renewals stop', () => {
    // The whole reason this is a lease. An offscreen document that crashed, was
    // killed by Chrome, or was thrown away by a developer reloading the
    // extension cannot say anything — so the page has to decide on its own.
    const h = leaseHarness();
    h.lease.renew();

    h.expire();

    expect(h.lease.mine).toBe(true);
    expect(h.changes).toEqual([false, true]);
  });

  it('waits three renewals before deciding nothing is coming', () => {
    // One missed message is a busy main thread, not a dead document.
    const h = leaseHarness();

    h.lease.renew();

    expect(h.armedFor).toBe(VOICE_LEASE_MS);
    expect(VOICE_LEASE_MS).toBeGreaterThan(VOICE_RENEW_MS * 2);
  });

  it('re-arms on every renewal so a live session never expires', () => {
    const h = leaseHarness();
    h.lease.renew();

    h.lease.renew();
    h.lease.renew();

    expect(h.armedFor).toBe(VOICE_LEASE_MS);
    expect(h.lease.mine).toBe(false);
  });

  it('gives the voice back immediately when the extension says so', () => {
    // A user who pressed Stop must not wait out a lease before the meeting can
    // hear them again.
    const h = leaseHarness();
    h.lease.renew();

    h.lease.release();

    expect(h.lease.mine).toBe(true);
    expect(h.changes).toEqual([false, true]);
    expect(h.armedFor).toBeNull();
  });

  it('does not report a release it never held', () => {
    const h = leaseHarness();

    h.lease.release();

    expect(h.changes).toEqual([]);
  });

  it('can be taken again after being given back', () => {
    const h = leaseHarness();
    h.lease.renew();
    h.lease.release();

    h.lease.renew();

    expect(h.lease.mine).toBe(false);
    expect(h.changes).toEqual([false, true, false]);
  });
});

function holdHarness() {
  const sent: boolean[] = [];
  let ticking: (() => void) | null = null;
  const hold = new VoiceHold({
    send: (mine) => sent.push(mine),
    setInterval: (run) => {
      ticking = run;
      return 1 as unknown as ReturnType<typeof setInterval>;
    },
    clearInterval: () => {
      ticking = null;
    },
  });
  return {
    hold,
    sent,
    tick: () => ticking?.(),
    get running() {
      return ticking !== null;
    },
  };
}

describe('VoiceHold', () => {
  it('says so immediately rather than waiting for the first tick', () => {
    // A session that took a second to close the gate is a second of the user's
    // real voice going out under a translation that is about to start.
    const h = holdHarness();

    h.hold.hold();

    expect(h.sent).toEqual([false]);
  });

  it('keeps restating it', () => {
    const h = holdHarness();
    h.hold.hold();

    h.tick();
    h.tick();

    expect(h.sent).toEqual([false, false, false]);
  });

  it('is idempotent, so a second start does not leave two tickers', () => {
    const h = holdHarness();
    h.hold.hold();

    h.hold.hold();

    expect(h.sent).toEqual([false]);
  });

  it('gives the voice back and stops renewing', () => {
    const h = holdHarness();
    h.hold.hold();

    h.hold.release();

    expect(h.sent).toEqual([false, true]);
    expect(h.running).toBe(false);
  });

  it('does not send anything on a release it never held', () => {
    // Teardown runs through more than one path — `stopDirection`, `endOutbound`
    // and `end` all release — and a capture that never sent must not tell a page
    // anything at all.
    const h = holdHarness();

    h.hold.release();
    h.hold.release();

    expect(h.sent).toEqual([]);
  });
});

describe('the two halves together', () => {
  it('survives a renewal arriving later than usual but sooner than the lease', () => {
    const changes: boolean[] = [];
    let pending: { run: () => void; ms: number } | null = null;
    const lease = new VoiceLease({
      onChange: (mine) => changes.push(mine),
      setTimer: (run, ms) => {
        pending = { run, ms };
        return 1 as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimer: () => {
        pending = null;
      },
    });
    const hold = new VoiceHold({
      send: (mine) => (mine ? lease.release() : lease.renew()),
      setInterval: () => 1 as unknown as ReturnType<typeof setInterval>,
      clearInterval: vi.fn(),
    });

    hold.hold();
    hold.release();

    expect(changes).toEqual([false, true]);
    expect(pending).toBeNull();
  });
});
