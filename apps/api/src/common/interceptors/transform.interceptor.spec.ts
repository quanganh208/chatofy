import { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { TransformInterceptor } from './transform.interceptor';

function httpContext(path: string, requestId?: string): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => ({ path, requestId }),
    }),
  } as unknown as ExecutionContext;
}

function handlerReturning(value: unknown): CallHandler {
  return { handle: () => of(value) };
}

describe('TransformInterceptor', () => {
  const interceptor = new TransformInterceptor();

  it('wraps HTTP payloads in the success envelope', async () => {
    const ctx = httpContext('/', 'req_abc');
    const result = (await lastValueFrom(
      interceptor.intercept(ctx, handlerReturning({ status: 'ok' })),
    )) as Record<string, unknown>;

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ status: 'ok' });
    const meta = result.meta as Record<string, unknown>;
    expect(meta.requestId).toBe('req_abc');
    expect(typeof meta.timestamp).toBe('string');
  });

  it('falls back to "unknown" requestId when middleware did not run', async () => {
    const ctx = httpContext('/');
    const result = (await lastValueFrom(
      interceptor.intercept(ctx, handlerReturning({ ok: 1 })),
    )) as Record<string, unknown>;
    expect((result.meta as Record<string, unknown>).requestId).toBe('unknown');
  });

  it('skips /health* routes (raw, not enveloped)', async () => {
    const raw = { status: 'ok', time: 't' };
    for (const path of ['/health', '/health/ready']) {
      const result = await lastValueFrom(
        interceptor.intercept(
          httpContext(path, 'req_x'),
          handlerReturning(raw),
        ),
      );
      expect(result).toBe(raw);
    }
  });

  it('passes through non-HTTP (WebSocket) contexts untouched', async () => {
    const wsCtx = { getType: () => 'ws' } as unknown as ExecutionContext;
    const raw = { event: 'frame' };
    const result = await lastValueFrom(
      interceptor.intercept(wsCtx, handlerReturning(raw)),
    );
    expect(result).toBe(raw);
  });

  it('does NOT special-case payloads containing a `success` field', async () => {
    const ctx = httpContext('/x', 'req_1');
    const payload = { success: false, value: 1 };
    const result = (await lastValueFrom(
      interceptor.intercept(ctx, handlerReturning(payload)),
    )) as Record<string, unknown>;
    // Still wrapped: payload becomes data, envelope.success is always true.
    expect(result.success).toBe(true);
    expect(result.data).toEqual(payload);
  });
});
