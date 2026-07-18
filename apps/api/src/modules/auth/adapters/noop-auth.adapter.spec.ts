import { NotImplementedException } from '@nestjs/common';
import { NoopAuthAdapter } from './noop-auth.adapter';

describe('NoopAuthAdapter', () => {
  // Promise-returning contract: failures must arrive as rejections so
  // `.then().catch()` callers observe them — never as synchronous throws.
  it('rejects verifyToken instead of throwing synchronously', async () => {
    const adapter = new NoopAuthAdapter();
    let promise!: Promise<unknown>;
    expect(() => {
      promise = adapter.verifyToken('token');
    }).not.toThrow();
    await expect(promise).rejects.toBeInstanceOf(NotImplementedException);
  });

  it('rejects getUser instead of throwing synchronously', async () => {
    const adapter = new NoopAuthAdapter();
    let promise!: Promise<unknown>;
    expect(() => {
      promise = adapter.getUser('u1');
    }).not.toThrow();
    await expect(promise).rejects.toBeInstanceOf(NotImplementedException);
  });
});
