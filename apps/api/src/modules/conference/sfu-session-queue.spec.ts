import { afterEach, describe, expect, it, vi } from 'vitest';
import { SfuSessionQueue } from './sfu-session-queue';

/** A promise the test settles by hand. */
function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('SfuSessionQueue', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs calls on one key in order, one at a time', async () => {
    const queue = new SfuSessionQueue(vi.fn());
    const log: string[] = [];
    const first = deferred();

    const a = queue.run('s', async () => {
      log.push('a start');
      await first.promise;
      log.push('a end');
    });
    const b = queue.run('s', async () => {
      log.push('b start');
      await Promise.resolve();
      log.push('b end');
    });
    await tick();
    first.resolve();
    await Promise.all([a, b]);

    expect(log).toStrictEqual(['a start', 'a end', 'b start', 'b end']);
  });

  it('runs different keys concurrently', async () => {
    const queue = new SfuSessionQueue(vi.fn());
    const blocker = deferred();
    const log: string[] = [];

    const a = queue.run('s1', async () => {
      await blocker.promise;
      log.push('s1');
    });
    await queue.run('s2', () => {
      log.push('s2');
      return Promise.resolve();
    });
    blocker.resolve();
    await a;

    expect(log).toStrictEqual(['s2', 's1']);
  });

  it('makes a run wait while a hold opened inside the previous run is open', async () => {
    const queue = new SfuSessionQueue(vi.fn());
    const log: string[] = [];
    let hold: { release(): void } | undefined;

    await queue.run('s', () => {
      hold = queue.hold('s', 10_000);
      return Promise.resolve();
    });
    const waiting = queue.run('s', () => {
      log.push('ran');
      return Promise.resolve();
    });
    await tick();
    expect(log).toStrictEqual([]);

    hold?.release();
    await waiting;
    expect(log).toStrictEqual(['ran']);
  });

  it('frees the key and reports it when a hold is never released', async () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const queue = new SfuSessionQueue(onTimeout);
    queue.hold('s', 10_000);
    const ran = vi.fn(() => Promise.resolve());
    const waiting = queue.run('s', ran);

    await vi.advanceTimersByTimeAsync(9_999);
    expect(ran).not.toHaveBeenCalled();
    expect(onTimeout).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await waiting;
    expect(onTimeout).toHaveBeenCalledWith('s');
    expect(ran).toHaveBeenCalledTimes(1);
  });

  it('does not let a throwing call block the next one', async () => {
    const queue = new SfuSessionQueue(vi.fn());

    await expect(
      queue.run('s', () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');
    await expect(queue.run('s', () => Promise.resolve('next'))).resolves.toBe(
      'next',
    );
  });

  it('keeps the key after disarm until release, with no timeout', async () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const queue = new SfuSessionQueue(onTimeout);
    const hold = queue.hold('s', 10_000);
    hold.disarm();
    const ran = vi.fn(() => Promise.resolve());
    const next = queue.run('s', ran);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(onTimeout).not.toHaveBeenCalled();
    expect(ran).not.toHaveBeenCalled();
    hold.release();
    await next;
    expect(ran).toHaveBeenCalledOnce();
  });
});
