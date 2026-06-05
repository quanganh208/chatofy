import {
  ArgumentsHost,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { AllExceptionsFilter } from './all-exceptions.filter';

interface MockResponse {
  headersSent: boolean;
  statusCode?: number;
  body?: unknown;
  status: (code: number) => MockResponse;
  json: (body: unknown) => MockResponse;
}

function mockResponse(headersSent = false): MockResponse {
  const res: MockResponse = {
    headersSent,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  return res;
}

function httpHost(res: MockResponse, requestId = 'req_1'): ArgumentsHost {
  return {
    getType: () => 'http',
    switchToHttp: () => ({
      getResponse: () => res,
      getRequest: () => ({ requestId, url: '/x' }),
    }),
  } as unknown as ArgumentsHost;
}

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter();

  it.each([
    [new UnauthorizedException(), 401, 'UNAUTHORIZED'],
    [new ForbiddenException(), 403, 'FORBIDDEN'],
    [new NotFoundException(), 404, 'NOT_FOUND'],
    [new ConflictException(), 409, 'CONFLICT'],
  ])('maps %s to status %i / code %s', (exception, status, code) => {
    const res = mockResponse();
    filter.catch(exception, httpHost(res));
    expect(res.statusCode).toBe(status);
    const body = res.body as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe(code);
  });

  it('returns a generic 500 message and never leaks the raw error text', () => {
    const res = mockResponse();
    filter.catch(
      new Error(
        'duplicate key value violates unique constraint "users_email_key"',
      ),
      httpHost(res),
    );
    expect(res.statusCode).toBe(500);
    const body = res.body as { error: { code: string; message: string } };
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('Internal server error');
    expect(JSON.stringify(res.body)).not.toContain('users_email_key');
  });

  it('maps zod validation errors to field-level details', () => {
    const schema = z.object({ email: z.string().email() });
    class Dto extends createZodDto(schema) {}
    let caught: unknown;
    try {
      new ZodValidationPipe().transform(
        { email: 'bad' },
        { metatype: Dto, type: 'body', data: '' },
      );
    } catch (e) {
      caught = e;
    }
    const res = mockResponse();
    filter.catch(caught, httpHost(res));
    expect(res.statusCode).toBe(400);
    const body = res.body as {
      error: { code: string; details?: { path: string; message: string }[] };
    };
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.details?.[0]?.path).toBe('email');
    expect(body.error.details?.[0]?.message).toBeTruthy();
    // Raw zod metadata (regex pattern) must not leak into details.
    expect(JSON.stringify(body.error.details)).not.toContain('pattern');
  });

  it('puts requestId + timestamp into meta', () => {
    const res = mockResponse();
    filter.catch(new NotFoundException(), httpHost(res, 'req_meta'));
    const body = res.body as { meta: { requestId: string; timestamp: string } };
    expect(body.meta.requestId).toBe('req_meta');
    expect(typeof body.meta.timestamp).toBe('string');
  });

  it('skips non-HTTP (WebSocket) contexts without writing a response', () => {
    const res = mockResponse();
    const wsHost = { getType: () => 'ws' } as unknown as ArgumentsHost;
    filter.catch(new Error('boom'), wsHost);
    expect(res.body).toBeUndefined();
  });

  it('bails out when headers are already sent', () => {
    const res = mockResponse(true);
    filter.catch(new NotFoundException(), httpHost(res));
    expect(res.body).toBeUndefined();
    expect(res.statusCode).toBeUndefined();
  });
});
