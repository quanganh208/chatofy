import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import {
  AUDIO_UPLOAD_STALL_TIMEOUT_MS,
  MAX_CONCURRENT_AUDIO_UPLOADS,
  limitConcurrentAudioUploads,
  requireBearerBeforeAudioUpload,
} from './narrow-body-limits';

/**
 * Both gates run as plain Express middleware, well before Nest exists for a
 * request, so a real `Request`/`Response` is not available here — these
 * doubles carry only what the two functions actually touch. `once`/`emit` are
 * hand-rolled rather than a real `EventEmitter`, matching the plain-object
 * double `request-id.middleware.spec.ts` already uses for the same reason:
 * nothing here needs a real socket, only the two lifecycle events the
 * middleware subscribes to.
 */
function fakeReq(opts: { method?: string; authorization?: string } = {}) {
  const listeners = new Map<'end', Array<() => void>>();
  return {
    method: opts.method ?? 'PUT',
    headers:
      opts.authorization === undefined
        ? {}
        : { authorization: opts.authorization },
    setTimeout: vi.fn(),
    destroy: vi.fn(),
    once: (event: 'end', cb: () => void) => {
      const existing = listeners.get(event) ?? [];
      existing.push(cb);
      listeners.set(event, existing);
    },
    emit: (event: 'end') => {
      for (const cb of listeners.get(event) ?? []) cb();
    },
  };
}

type FakeRes = ReturnType<typeof fakeRes>;

function fakeRes() {
  const listeners = new Map<'finish' | 'close', Array<() => void>>();
  const res = {
    status: vi.fn((_code: number) => res),
    json: vi.fn(),
    once: (event: 'finish' | 'close', cb: () => void) => {
      const existing = listeners.get(event) ?? [];
      existing.push(cb);
      listeners.set(event, existing);
    },
    emit: (event: 'finish' | 'close') => {
      for (const cb of listeners.get(event) ?? []) cb();
    },
  };
  return res;
}

// Every slot a test acquires from the shared, module-level counter is
// released here, regardless of how the test asserted on it — otherwise one
// test's held slots would decide whether the NEXT test starts under the
// ceiling.
const acquired: FakeRes[] = [];
afterEach(() => {
  for (const res of acquired) res.emit('finish');
  acquired.length = 0;
});

/** Runs the concurrency gate and, if it let the request through, tracks it for cleanup. */
function runConcurrencyGate(
  req: ReturnType<typeof fakeReq>,
  res: FakeRes,
  next: NextFunction,
): void {
  limitConcurrentAudioUploads(
    req as unknown as Request,
    res as unknown as Response,
    next,
  );
}

describe('requireBearerBeforeAudioUpload', () => {
  it('refuses a PUT with no Authorization header, before any body is read', () => {
    const req = fakeReq({ authorization: undefined });
    const res = fakeRes();
    const next: NextFunction = vi.fn();

    requireBearerBeforeAudioUpload(
      req as unknown as Request,
      res as unknown as Response,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Unauthorized' },
      }),
    );
    // The same envelope shape AllExceptionsFilter emits, not express's HTML
    // default — this is the whole point of not calling next(err) here.
    const body = res.json.mock.calls[0]![0] as {
      meta: { requestId: string; timestamp: string };
    };
    expect(typeof body.meta.requestId).toBe('string');
    expect(typeof body.meta.timestamp).toBe('string');
  });

  it('lets a PUT with an Authorization header through, whatever it says', () => {
    // The token itself is JwtAuthGuard's job, downstream of this. A forged
    // value must still pass here — that guard is what actually rejects it.
    const req = fakeReq({ authorization: 'Bearer not-a-real-token' });
    const res = fakeRes();
    const next: NextFunction = vi.fn();

    requireBearerBeforeAudioUpload(
      req as unknown as Request,
      res as unknown as Response,
      next,
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('does not touch a non-PUT request', () => {
    const req = fakeReq({ method: 'GET', authorization: undefined });
    const res = fakeRes();
    const next: NextFunction = vi.fn();

    requireBearerBeforeAudioUpload(
      req as unknown as Request,
      res as unknown as Response,
      next,
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe('limitConcurrentAudioUploads', () => {
  it('answers 429 once the ceiling is reached, with the standard envelope', () => {
    for (let i = 0; i < MAX_CONCURRENT_AUDIO_UPLOADS; i += 1) {
      const req = fakeReq();
      const res = fakeRes();
      const next: NextFunction = vi.fn();
      runConcurrencyGate(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
      acquired.push(res);
    }

    const overCeiling = fakeReq();
    const res = fakeRes();
    const next: NextFunction = vi.fn();
    runConcurrencyGate(overCeiling, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: { code: 'RATE_LIMITED', message: expect.any(String) },
      }),
    );
  });

  it('releases the slot on normal completion, so the ceiling does not decay', () => {
    for (let i = 0; i < MAX_CONCURRENT_AUDIO_UPLOADS; i += 1) {
      const req = fakeReq();
      const res = fakeRes();
      runConcurrencyGate(req, res, vi.fn());
      acquired.push(res);
    }

    // Finish exactly one of them — a normal response completing.
    acquired.pop()!.emit('finish');

    const req = fakeReq();
    const res = fakeRes();
    const next: NextFunction = vi.fn();
    runConcurrencyGate(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    acquired.push(res);
  });

  it('releases the slot on a client abort (close without finish)', () => {
    for (let i = 0; i < MAX_CONCURRENT_AUDIO_UPLOADS; i += 1) {
      const req = fakeReq();
      const res = fakeRes();
      runConcurrencyGate(req, res, vi.fn());
      acquired.push(res);
    }

    acquired.pop()!.emit('close');

    const req = fakeReq();
    const res = fakeRes();
    const next: NextFunction = vi.fn();
    runConcurrencyGate(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    acquired.push(res);
  });

  it('releases a slot only once even when both finish and close fire', () => {
    for (let i = 0; i < MAX_CONCURRENT_AUDIO_UPLOADS; i += 1) {
      const req = fakeReq();
      const res = fakeRes();
      runConcurrencyGate(req, res, vi.fn());
      acquired.push(res);
    }

    // A double release here would free two slots for one finished request,
    // silently raising the effective ceiling above what was configured.
    const doubleReleased = acquired.pop()!;
    doubleReleased.emit('finish');
    doubleReleased.emit('close');

    const first = { req: fakeReq(), res: fakeRes(), next: vi.fn() };
    runConcurrencyGate(first.req, first.res, first.next);
    expect(first.next).toHaveBeenCalledTimes(1);
    acquired.push(first.res);

    const second = { req: fakeReq(), res: fakeRes(), next: vi.fn() };
    runConcurrencyGate(second.req, second.res, second.next);
    expect(second.next).not.toHaveBeenCalled();
  });

  it('does not touch a non-PUT request or count it against the ceiling', () => {
    const req = fakeReq({ method: 'GET' });
    const res = fakeRes();
    const next: NextFunction = vi.fn();
    runConcurrencyGate(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(req.setTimeout).not.toHaveBeenCalled();
  });

  it('arms a stall timeout that destroys the connection if it fires', () => {
    const req = fakeReq();
    const res = fakeRes();
    runConcurrencyGate(req, res, vi.fn());
    acquired.push(res);

    expect(req.setTimeout).toHaveBeenCalledWith(
      AUDIO_UPLOAD_STALL_TIMEOUT_MS,
      expect.any(Function),
    );
    const onStall = req.setTimeout.mock.calls[0]![1] as () => void;
    onStall();
    expect(req.destroy).toHaveBeenCalledTimes(1);
  });

  it('disarms the stall timeout when the BODY ends, not when the response does', () => {
    // The distinction is the whole point of the bound. `req.setTimeout` arms a
    // socket idle timer, and the controller and the storage PUT that follow are
    // silent on the socket — no bytes in, none out until the response — so a
    // deadline left armed past the body fires on an upload that is progressing
    // perfectly, on any link slow enough to spend 30s shipping 32 MB onward.
    const req = fakeReq();
    const res = fakeRes();
    runConcurrencyGate(req, res, vi.fn());
    // This case ends the BODY and never the response, so nothing here releases
    // the slot it just took from the module-level counter. Registering it hands
    // that job to `afterEach`; without this the ceiling stays one lower for
    // every case declared after it, and the next ceiling assertion added to the
    // bottom of this file fails in a way that reads as a middleware bug.
    acquired.push(res);

    req.emit('end');
    expect(req.setTimeout).toHaveBeenLastCalledWith(0);
  });

  it('does not disarm on a body drained after the response already went out', () => {
    // The ordering a body the raw parser does not claim produces: the route
    // answers without reading anything, and Node drains the request inside its
    // own `finish` handler — the same one that has just re-armed the socket at
    // `keepAliveTimeout`. Disarming on that late `end` would clear the ceiling
    // a moment after it was set, and the socket would sit in the pool with
    // none. Nothing of ours is still armed by then, so skipping is safe.
    const req = fakeReq();
    const res = fakeRes();
    runConcurrencyGate(req, res, vi.fn());
    const armed = req.setTimeout.mock.calls.length;

    res.emit('finish');
    req.emit('end');

    expect(req.setTimeout.mock.calls.length).toBe(armed);
  });

  it('leaves the socket deadline alone once the response finishes', () => {
    // Node re-arms the socket at `keepAliveTimeout` in its own `finish`
    // handler, which is registered before this middleware's and so runs first.
    // Clearing the timer after that would strip the server's idle-socket
    // ceiling from every connection that completed an upload, letting a caller
    // park sockets indefinitely.
    const req = fakeReq();
    const res = fakeRes();
    runConcurrencyGate(req, res, vi.fn());
    const armed = req.setTimeout.mock.calls.length;

    res.emit('finish');

    expect(req.setTimeout.mock.calls.length).toBe(armed);
  });

  // Last on purpose. The counter this gate reads is module-level, so a case
  // that takes a slot and neither ends its response nor registers it for the
  // cleanup above leaves the ceiling one lower for everything declared after
  // it — and the symptom lands on whoever adds the NEXT case, as a 429 that
  // reads like a middleware bug rather than a bookkeeping one in the suite.
  // Asserting a full set of acquisitions still succeeds keeps that honest.
  it('still admits a full set of uploads after every case above it', () => {
    for (let i = 0; i < MAX_CONCURRENT_AUDIO_UPLOADS; i += 1) {
      const res = fakeRes();
      const next = vi.fn();
      runConcurrencyGate(fakeReq(), res, next);
      acquired.push(res);
      expect(next).toHaveBeenCalledTimes(1);
    }
  });
});
