import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CallHandler,
  Controller,
  ExecutionContext,
  Get,
  HttpCode,
  INestApplication,
  Post,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { lastValueFrom, of } from 'rxjs';
import request from 'supertest';
import { App } from 'supertest/types';
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

  it('skips /health (raw, not enveloped)', async () => {
    const raw = { status: 'ok', time: 't' };
    const result = await lastValueFrom(
      interceptor.intercept(
        httpContext('/health', 'req_x'),
        handlerReturning(raw),
      ),
    );
    expect(result).toBe(raw);
  });

  // The exemption is a path rule, not a route lookup, so the boundary it draws
  // is worth pinning: a route merely PREFIXED with the word must still be
  // enveloped. A plain `startsWith('/health')` would silently exempt it.
  it('does NOT skip a route that merely starts with /health', async () => {
    const result = (await lastValueFrom(
      interceptor.intercept(
        httpContext('/healthcheck', 'req_x'),
        handlerReturning({ status: 'ok' }),
      ),
    )) as Record<string, unknown>;
    expect(result.success).toBe(true);
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

describe('TransformInterceptor: payment webhooks', () => {
  const interceptor = new TransformInterceptor();

  it('skips /billing/webhooks/* (raw, not enveloped)', async () => {
    const raw = { success: true };
    for (const path of [
      '/billing/webhooks/sepay',
      '/billing/webhooks/polar',
      '/Billing/Webhooks/SePay',
    ]) {
      const result = await lastValueFrom(
        interceptor.intercept(
          httpContext(path, 'req_x'),
          handlerReturning(raw),
        ),
      );
      expect(result).toBe(raw);
    }
  });

  it('still wraps /billing/me and a path merely starting with the word', async () => {
    for (const path of [
      '/billing/me',
      '/billing/webhooksx',
      '/billing/webhooks',
    ]) {
      const result = (await lastValueFrom(
        interceptor.intercept(
          httpContext(path, 'req_x'),
          handlerReturning({ a: 1 }),
        ),
      )) as Record<string, unknown>;
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ a: 1 });
    }
  });
});

/**
 * The bytes on the wire, through Nest's real HTTP stack with the interceptor
 * registered globally as `CommonModule` does: SePay compares the body text, so
 * a parsed-object assertion would pass on an enveloped reply it rejects.
 */
describe('TransformInterceptor over HTTP', () => {
  @Controller('billing')
  class ProbeController {
    @Post('webhooks/sepay')
    @HttpCode(200)
    sepay() {
      return { success: true };
    }

    @Get('me')
    me() {
      return { plan: 'free' };
    }
  }

  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController],
      providers: [{ provide: APP_INTERCEPTOR, useClass: TransformInterceptor }],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers POST /billing/webhooks/sepay with exactly {"success":true} and 200', async () => {
    const res = await request(app.getHttpServer())
      .post('/billing/webhooks/sepay')
      .buffer(true)
      .parse((response, done) => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => (text += chunk));
        response.on('end', () => done(null, text));
      });
    expect(res.status).toBe(200);
    expect(res.body).toBe('{"success":true}');
  });

  it('still envelopes GET /billing/me', async () => {
    const res = await request(app.getHttpServer()).get('/billing/me');
    expect(res.status).toBe(200);
    expect(res.text.startsWith('{"success":true,"data":{"plan":"free"}')).toBe(
      true,
    );
  });
});
