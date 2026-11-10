import { afterEach, describe, expect, it, vi } from 'vitest';
import { InMemoryCreditLedger } from '../../../test/utils/in-memory-credit-ledger';
import type { StreamSocket } from '../translate/session/stream-socket';
import {
  LEASE_AUDIO_SECONDS,
  LEASE_GRACE_MS,
  REAPER_INTERVAL_MS,
} from './credit-pricing';
import {
  EXTEND_RETRY_DELAYS_MS,
  MAX_ADMITS_IN_FLIGHT_PER_USER,
  MAX_LEDGER_CALLS_PER_USER,
  TranslationMeter,
  type CreditStopReason,
} from './translation-meter';

/** Lets the in-memory ledger's promise chains run to completion. */
const flush = async () => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};

interface Sent {
  type: string;
  code?: string;
  remainingCreditSeconds?: number;
}

function harness(credits: number) {
  // No Free grant: every case states its whole balance.
  const ledger = new InMemoryCreditLedger({ freeCredits: 0 });
  const meter = new TranslationMeter(ledger);
  const userId = `user-${Math.random()}`;
  if (credits > 0) {
    void ledger.grant({
      userId,
      source: 'promo',
      amount: credits,
      externalRef: `promo:${userId}`,
    });
  }
  const socket = { send: vi.fn() } satisfies StreamSocket;
  const stops: CreditStopReason[] = [];
  meter.attach(socket, userId, (reason) => stops.push(reason));
  const sent = () =>
    socket.send.mock.calls.map(([body]) => JSON.parse(String(body)) as Sent);
  const errors = (code: string) => sent().filter((e) => e.code === code);
  const settles = () => ledger.entries.filter((e) => e.kind === 'settle');
  const balance = async () => (await ledger.balance(userId)).available;
  /** Feed `seconds` of accepted audio in 1 s frames, letting extends land between. */
  const speak = async (sessionId: string, seconds: number) => {
    for (let i = 0; i < seconds; i += 1) {
      meter.onFrame(socket, sessionId, 1);
      await flush();
    }
  };
  return {
    ledger,
    meter,
    userId,
    socket,
    stops,
    errors,
    settles,
    balance,
    speak,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('TranslationMeter', () => {
  describe('admit', () => {
    it('refuses a start at 59 credit-seconds and reports what is left', async () => {
      const { meter, socket } = harness(59);
      await expect(meter.admit(socket, 1)).resolves.toEqual({
        admitted: false,
        code: 'credits_exhausted',
        remainingCreditSeconds: 59,
      });
    });

    it('admits a start at exactly one credit', async () => {
      const { meter, socket } = harness(60);
      await expect(meter.admit(socket, 1)).resolves.toEqual({
        admitted: true,
      });
    });

    it('refuses with credits_unavailable when the ledger cannot be reached', async () => {
      const { meter, socket, ledger } = harness(600);
      ledger.setUnavailable(true);
      await expect(meter.admit(socket, 1)).resolves.toMatchObject({
        admitted: false,
        code: 'credits_unavailable',
      });
    });

    it('refuses a socket with no verified owner without asking the ledger', async () => {
      const { meter, ledger } = harness(600);
      const openLease = vi.spyOn(ledger, 'openLease');
      await expect(meter.admit({ send: vi.fn() }, 1)).resolves.toMatchObject({
        admitted: false,
        code: 'credits_exhausted',
      });
      expect(openLease).not.toHaveBeenCalled();
    });

    it('holds a lease shrunk to the balance when the balance is short of one', async () => {
      const { meter, socket, ledger, balance } = harness(100);
      const openLease = vi.spyOn(ledger, 'openLease');
      await meter.admit(socket, 2);
      expect(openLease).toHaveBeenCalledWith(
        expect.any(String),
        LEASE_AUDIO_SECONDS * 2,
      );
      expect(await balance()).toBe(0);
      expect(
        ledger.entries
          .filter((e) => e.kind === 'reserve')
          .reduce((sum, e) => sum - e.amount, 0),
      ).toBe(100);
    });

    it('does not reach the ledger for a start the lease already covers', async () => {
      const { meter, socket, ledger } = harness(6000);
      await meter.admit(socket, 1);
      const extend = vi.spyOn(ledger, 'extendLease');
      const open = vi.spyOn(ledger, 'openLease');
      await meter.admit(socket, 1);
      expect(extend).not.toHaveBeenCalled();
      expect(open).not.toHaveBeenCalled();
    });

    it('refuses a restart on a lease the reaper took once the balance was spent elsewhere', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      const { meter, socket, ledger, userId, balance } = harness(120);
      await meter.admit(socket, 1);
      meter.turnOpened(socket, 's1', 1);
      meter.onFrame(socket, 's1', 10);
      meter.turnEnded('s1');
      await flush();
      expect(await balance()).toBe(0);

      // The socket idles past the lease's expiry; the reaper releases the
      // unspent 110, and another device of the same account spends it.
      vi.advanceTimersByTime(
        LEASE_AUDIO_SECONDS * 1000 + LEASE_GRACE_MS + REAPER_INTERVAL_MS,
      );
      const leaseId = ledger.entries.find(
        (e) => e.kind === 'reserve',
      )!.leaseId!;
      expect(ledger.reap(leaseId)).toBe(true);
      await ledger.debit({ userId, amount: 110, idempotencyKey: 'elsewhere' });
      expect(await balance()).toBe(0);

      // The mirror still shows 110 of room; the ledger is asked, and says no.
      await expect(meter.admit(socket, 1)).resolves.toEqual({
        admitted: false,
        code: 'credits_exhausted',
        remainingCreditSeconds: 0,
      });
      await meter.detach(socket);
    });

    it('asks the ledger again once the lease is within a reaper tick of expiry', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      const { meter, socket, ledger } = harness(6000);
      await meter.admit(socket, 1);
      const extend = vi.spyOn(ledger, 'extendLease');
      vi.advanceTimersByTime(
        LEASE_AUDIO_SECONDS * 1000 + LEASE_GRACE_MS - REAPER_INTERVAL_MS - 1,
      );
      await meter.admit(socket, 1);
      expect(extend).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      await meter.admit(socket, 1);
      expect(extend).toHaveBeenCalledTimes(1);
      // The extend touched the lease, so the next start trusts the mirror again.
      await meter.admit(socket, 1);
      expect(extend).toHaveBeenCalledTimes(1);
      await meter.detach(socket);
    });
  });

  describe('settling', () => {
    it.each([
      ['captions', 1, 10],
      ['voice', 2, 20],
      ['voice into three languages', 6, 60],
    ])(
      'bills 10 s of %s at its multiplier',
      async (_name, multiplier, expected) => {
        const { meter, socket, settles, speak } = harness(6000);
        await meter.admit(socket, multiplier);
        meter.turnOpened(socket, 's1', multiplier);
        await speak('s1', 10);
        meter.turnEnded('s1');
        await meter.detach(socket);
        expect(settles().map((e) => -e.amount)).toEqual([expected]);
      },
    );

    it('counts only accepted audio', async () => {
      const { meter, socket, settles } = harness(6000);
      await meter.admit(socket, 1);
      meter.turnOpened(socket, 's1', 1);
      meter.onFrame(socket, 's1', 0);
      meter.onFrame(socket, 's1', 2.4);
      meter.onFrame(socket, 's1', 0);
      meter.turnEnded('s1');
      await meter.detach(socket);
      expect(settles().map((e) => -e.amount)).toEqual([2]);
    });

    it('settles a turn once, with its session and conversation ids', async () => {
      const { meter, socket, settles } = harness(6000);
      await meter.admit(socket, 1);
      meter.turnOpened(socket, 's1', 1, 'conv-1');
      meter.turnOpened(socket, 's2', 1);
      meter.onFrame(socket, 's1', 5);
      meter.onFrame(socket, 's2', 3);
      meter.turnEnded('s1');
      meter.turnEnded('s1');
      meter.turnEnded('s2');
      await meter.detach(socket);
      expect(
        settles().map(({ sessionId, conversationId, amount }) => ({
          sessionId,
          conversationId,
          amount,
        })),
      ).toEqual([
        { sessionId: 's1', conversationId: 'conv-1', amount: -5 },
        { sessionId: 's2', conversationId: null, amount: -3 },
      ]);
    });

    it('detach settles turns still open, waits for every settle, and forgets them all', async () => {
      const { meter, socket, ledger, balance } = harness(6000);
      await meter.admit(socket, 1);
      meter.turnOpened(socket, 's1', 1);
      meter.turnOpened(socket, 's2', 1);
      meter.onFrame(socket, 's1', 7);
      meter.onFrame(socket, 's2', 4);
      meter.turnEnded('s1');
      expect(meter.trackedTurns).toBe(1);
      await meter.detach(socket);
      expect(meter.trackedTurns).toBe(0);
      // The lease is closed and everything not consumed is back.
      expect(await balance()).toBe(6000 - 11);
      expect(ledger.entries.some((e) => e.kind === 'release')).toBe(true);
    });

    it('settles on a fresh lease when the reaper took the old one', async () => {
      const { meter, socket, ledger, settles, balance } = harness(6000);
      await meter.admit(socket, 1);
      meter.turnOpened(socket, 's1', 1);
      meter.onFrame(socket, 's1', 9);
      const leaseId = ledger.entries.find(
        (e) => e.kind === 'reserve',
      )!.leaseId!;
      expect(ledger.reap(leaseId)).toBe(true);
      meter.turnEnded('s1');
      await meter.detach(socket);
      expect(settles().map((e) => -e.amount)).toEqual([9]);
      expect(settles()[0]!.leaseId).not.toBe(leaseId);
      // Released once by the reaper, never again: only the 9 s were spent.
      expect(await balance()).toBe(6000 - 9);
    });

    it('retries a settle that failed once at detach', async () => {
      const { meter, socket, ledger, settles } = harness(6000);
      await meter.admit(socket, 1);
      meter.turnOpened(socket, 's1', 1);
      meter.onFrame(socket, 's1', 4);
      ledger.setUnavailable(true);
      meter.turnEnded('s1');
      await flush();
      expect(settles()).toHaveLength(0);
      ledger.setUnavailable(false);
      await meter.detach(socket);
      expect(settles().map((e) => -e.amount)).toEqual([4]);
    });
  });

  describe('rounding', () => {
    it('carries sub-credit-second turns instead of dropping them', async () => {
      const { meter, socket, settles } = harness(6000);
      await meter.admit(socket, 1);
      // Ten 0.4 s turns: each alone rounds to nothing, together they are 4.
      for (let i = 0; i < 10; i += 1) {
        meter.turnOpened(socket, `t${i}`, 1, 'conv-1');
        meter.onFrame(socket, `t${i}`, 0.4);
        meter.turnEnded(`t${i}`);
      }
      await meter.detach(socket);
      expect(settles().reduce((sum, e) => sum - e.amount, 0)).toBe(4);
    });

    it('settles the last remainder, rounded, on the last turn when the socket goes', async () => {
      const { meter, socket, settles } = harness(6000);
      await meter.admit(socket, 1);
      meter.turnOpened(socket, 's1', 2, 'conv-1');
      meter.onFrame(socket, 's1', 1.3);
      meter.turnEnded('s1');
      await meter.detach(socket);
      expect(
        settles().map(({ sessionId, conversationId, amount }) => ({
          sessionId,
          conversationId,
          amount,
        })),
      ).toEqual([
        { sessionId: 's1', conversationId: 'conv-1', amount: -2 },
        { sessionId: 's1', conversationId: 'conv-1', amount: -1 },
      ]);
    });
  });

  describe('database pressure from one account', () => {
    it('runs at most the per-user share of ledger calls at once, queueing the rest', async () => {
      const { meter, ledger, userId } = harness(60_000);
      let running = 0;
      let peak = 0;
      const gates: Array<() => void> = [];
      vi.spyOn(ledger, 'openLease').mockImplementation(async (user, want) => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise<void>((resolve) => gates.push(resolve));
        running -= 1;
        return InMemoryCreditLedger.prototype.openLease.call(
          ledger,
          user,
          want,
        );
      });
      const sockets = Array.from(
        { length: MAX_ADMITS_IN_FLIGHT_PER_USER },
        () => {
          const s = { send: vi.fn() } satisfies StreamSocket;
          meter.attach(s, userId, () => {});
          return s;
        },
      );
      const admits = sockets.map((s) => meter.admit(s, 1));
      await flush();
      expect(peak).toBe(MAX_LEDGER_CALLS_PER_USER);
      while (gates.length > 0) {
        gates.shift()!();
        await flush();
      }
      for (const admitted of await Promise.all(admits)) {
        expect(admitted).toEqual({ admitted: true });
      }
      expect(peak).toBe(MAX_LEDGER_CALLS_PER_USER);
    });

    it('refuses starts beyond the in-flight cap without touching the ledger', async () => {
      const { meter, ledger, userId } = harness(60_000);
      const gates: Array<() => void> = [];
      const openLease = vi
        .spyOn(ledger, 'openLease')
        .mockImplementation(async (user, want) => {
          await new Promise<void>((resolve) => gates.push(resolve));
          return InMemoryCreditLedger.prototype.openLease.call(
            ledger,
            user,
            want,
          );
        });
      const socketFor = () => {
        const s = { send: vi.fn() } satisfies StreamSocket;
        meter.attach(s, userId, () => {});
        return s;
      };
      const waiting = Array.from(
        { length: MAX_ADMITS_IN_FLIGHT_PER_USER },
        () => meter.admit(socketFor(), 1),
      );
      await flush();
      // The transient code clients retry, never a credit code that ends the run.
      await expect(meter.admit(socketFor(), 1)).resolves.toEqual({
        admitted: false,
        code: 'too_many_turns',
        remainingCreditSeconds: 0,
      });
      while (gates.length > 0) {
        gates.shift()!();
        await flush();
      }
      await Promise.all(waiting);
      expect(openLease).toHaveBeenCalledTimes(MAX_ADMITS_IN_FLIGHT_PER_USER);
      // Once they drain, the next start goes through.
      openLease.mockRestore();
      await expect(meter.admit(socketFor(), 1)).resolves.toEqual({
        admitted: true,
      });
    });

    it('a start that needs an extend joins the one already in flight', async () => {
      const { meter, socket, ledger } = harness(6000);
      await meter.admit(socket, 1);
      meter.turnOpened(socket, 's1', 1);
      let release!: () => void;
      const extend = vi
        .spyOn(ledger, 'extendLease')
        .mockImplementation(async (leaseId, want) => {
          await new Promise<void>((resolve) => (release = resolve));
          return InMemoryCreditLedger.prototype.extendLease.call(
            ledger,
            leaseId,
            want,
          );
        });
      // Under 30 s of headroom: the background extend starts.
      for (let i = 0; i < 95; i += 1) meter.onFrame(socket, 's1', 1);
      await flush();
      const admitted = meter.admit(socket, 1);
      await flush();
      expect(extend).toHaveBeenCalledTimes(1);
      release();
      await expect(admitted).resolves.toEqual({ admitted: true });
      expect(extend).toHaveBeenCalledTimes(1);
      await meter.detach(socket);
    });
  });

  describe('extending', () => {
    it('extends once at a time as audio nears the end of the lease', async () => {
      const { meter, socket, ledger } = harness(6000);
      await meter.admit(socket, 1);
      meter.turnOpened(socket, 's1', 1);
      let release!: () => void;
      const extend = vi
        .spyOn(ledger, 'extendLease')
        .mockImplementationOnce(async (leaseId, want) => {
          await new Promise<void>((resolve) => (release = resolve));
          return InMemoryCreditLedger.prototype.extendLease.call(
            ledger,
            leaseId,
            want,
          );
        });
      // 120 s held; under 30 s left from 91 s on.
      for (let i = 0; i < 100; i += 1) meter.onFrame(socket, 's1', 1);
      await flush();
      expect(extend).toHaveBeenCalledTimes(1);
      release();
      await flush();
      await meter.detach(socket);
    });

    it('reopens a lease the reaper took while the socket idled', async () => {
      const { meter, socket, ledger, settles, balance } = harness(6000);
      await meter.admit(socket, 1);
      meter.turnOpened(socket, 's1', 1);
      meter.onFrame(socket, 's1', 10);
      meter.turnEnded('s1');
      await flush();
      const first = ledger.entries.find((e) => e.kind === 'reserve')!.leaseId!;
      ledger.reap(first);
      const open = vi.spyOn(ledger, 'openLease');
      meter.turnOpened(socket, 's2', 1);
      await harnessSpeak(meter, socket, 's2', 100);
      expect(open).toHaveBeenCalledTimes(1);
      await meter.detach(socket);
      expect(settles().map((e) => -e.amount)).toEqual([10, 100]);
      expect(await balance()).toBe(6000 - 110);
    });

    it('stops a running turn whose lease the reaper took once the balance was spent elsewhere', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      const { meter, socket, ledger, userId, stops } = harness(120);
      await meter.admit(socket, 1);
      meter.turnOpened(socket, 's1', 1);
      vi.advanceTimersByTime(
        LEASE_AUDIO_SECONDS * 1000 + LEASE_GRACE_MS + REAPER_INTERVAL_MS,
      );
      const leaseId = ledger.entries.find(
        (e) => e.kind === 'reserve',
      )!.leaseId!;
      ledger.reap(leaseId);
      await ledger.debit({ userId, amount: 120, idempotencyKey: 'elsewhere' });

      // Plenty of room by the mirror, none by the ledger: the first frames
      // confirm the lease, find it gone, and stop the turn.
      await harnessSpeak(meter, socket, 's1', 3);
      expect(stops).toEqual(['credits_exhausted']);
      await meter.detach(socket);
    });

    it('fails open for one lease when an extend throws, retries with backoff, then stops with credits_unavailable', async () => {
      vi.useFakeTimers();
      const { meter, socket, ledger, stops, errors } = harness(6000);
      await meter.admit(socket, 1);
      meter.turnOpened(socket, 's1', 1);
      ledger.setUnavailable(true);
      const extend = vi.spyOn(ledger, 'extendLease');
      // Past the 30 s mark: the first extend fails and grants one virtual lease.
      for (let i = 0; i < 95; i += 1) meter.onFrame(socket, 's1', 1);
      await flush();
      expect(extend).toHaveBeenCalledTimes(1);
      for (const delay of EXTEND_RETRY_DELAYS_MS) {
        await vi.advanceTimersByTimeAsync(delay);
      }
      expect(extend).toHaveBeenCalledTimes(1 + EXTEND_RETRY_DELAYS_MS.length);
      expect(stops).toEqual([]);
      // The real lease (120) and the virtual one (120) are spent at 240 s.
      for (let i = 95; i < 239; i += 1) meter.onFrame(socket, 's1', 1);
      expect(stops).toEqual([]);
      meter.onFrame(socket, 's1', 1);
      expect(stops).toEqual(['credits_unavailable']);
      expect(errors('credits_unavailable')).toHaveLength(1);
      ledger.setUnavailable(false);
      await meter.detach(socket);
    });

    it('a recovered ledger ends the outage and drops the virtual lease', async () => {
      vi.useFakeTimers();
      const { meter, socket, ledger, stops } = harness(6000);
      await meter.admit(socket, 1);
      meter.turnOpened(socket, 's1', 1);
      ledger.setUnavailable(true);
      for (let i = 0; i < 95; i += 1) meter.onFrame(socket, 's1', 1);
      await flush();
      ledger.setUnavailable(false);
      await vi.advanceTimersByTimeAsync(EXTEND_RETRY_DELAYS_MS[0]);
      for (let i = 95; i < 300; i += 1) {
        meter.onFrame(socket, 's1', 1);
        await flush();
      }
      expect(stops).toEqual([]);
      await meter.detach(socket);
    });
  });

  describe('running out', () => {
    it('warns once when low, then stops once when the lease is spent and nothing more is granted', async () => {
      const { meter, socket, stops, errors, speak, settles, balance } =
        harness(60);
      await meter.admit(socket, 1);
      expect(errors('credits_low')).toEqual([
        {
          type: 'server.error',
          code: 'credits_low',
          message: expect.any(String),
          remainingCreditSeconds: 60,
        },
      ]);
      meter.turnOpened(socket, 's1', 1);
      await speak('s1', 59);
      expect(stops).toEqual([]);
      await speak('s1', 1);
      expect(stops).toEqual(['credits_exhausted']);
      expect(errors('credits_exhausted')).toHaveLength(1);
      expect(errors('credits_low')).toHaveLength(1);
      meter.turnEnded('s1');
      await meter.detach(socket);
      // Stopped exactly at the balance: settled at what was accepted.
      expect(settles().reduce((sum, e) => sum - e.amount, 0)).toBe(60);
      expect(await balance()).toBe(0);
    });

    it('does not warn a connection with plenty of credit', async () => {
      const { meter, socket, errors } = harness(6000);
      await meter.admit(socket, 1);
      expect(errors('credits_low')).toEqual([]);
    });

    it('admits again after a stop once credit has been added', async () => {
      const { meter, socket, ledger, userId, stops, speak } = harness(60);
      await meter.admit(socket, 1);
      meter.turnOpened(socket, 's1', 1);
      await speak('s1', 70);
      expect(stops).toEqual(['credits_exhausted']);
      meter.turnEnded('s1');
      await flush();
      await expect(meter.admit(socket, 1)).resolves.toMatchObject({
        admitted: false,
      });
      await ledger.grant({
        userId,
        source: 'topup',
        amount: 600,
        externalRef: 'topup-late',
      });
      await expect(meter.admit(socket, 1)).resolves.toEqual({
        admitted: true,
      });
      await meter.detach(socket);
    });
  });
});

/** `speak` for a meter outside the harness closure. */
async function harnessSpeak(
  meter: TranslationMeter,
  socket: StreamSocket,
  sessionId: string,
  seconds: number,
): Promise<void> {
  for (let i = 0; i < seconds; i += 1) {
    meter.onFrame(socket, sessionId, 1);
    await flush();
  }
}
