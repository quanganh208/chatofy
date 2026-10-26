import { describe, expect, it, vi } from 'vitest';
import { SerialChain } from './serial-chain';

describe('SerialChain', () => {
  it('runs tasks one at a time, in the order they were queued', async () => {
    const chain = new SerialChain();
    const log: string[] = [];
    const task = (name: string, ms: number) => async () => {
      log.push(`${name}:start`);
      await new Promise((resolve) => setTimeout(resolve, ms));
      log.push(`${name}:end`);
    };
    chain.enqueue(task('a', 20), () => undefined);
    chain.enqueue(task('b', 0), () => undefined);
    await chain.drained();
    expect(log).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
  });

  it('hands a rejection to its handler and still runs the next task', async () => {
    const chain = new SerialChain();
    const onError = vi.fn();
    const ran = vi.fn();
    chain.enqueue(() => Promise.reject(new Error('boom')), onError);
    chain.enqueue(
      () => Promise.resolve(ran()),
      () => undefined,
    );
    await chain.drained();
    expect(onError).toHaveBeenCalledWith(new Error('boom'));
    expect(ran).toHaveBeenCalledOnce();
  });

  it('resolves drained() even when the last task failed', async () => {
    const chain = new SerialChain();
    chain.enqueue(
      () => Promise.reject(new Error('last')),
      () => undefined,
    );
    await expect(chain.drained()).resolves.toBeUndefined();
  });
});
