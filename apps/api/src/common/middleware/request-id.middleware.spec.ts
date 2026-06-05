import { NextFunction, Request, Response } from 'express';
import { requestIdMiddleware } from './request-id.middleware';

function run(headerValue?: string | string[]): {
  req: Partial<Request>;
  header?: string;
} {
  const req = {
    headers: headerValue === undefined ? {} : { 'x-request-id': headerValue },
  } as unknown as Request;
  let header: string | undefined;
  const res = {
    setHeader: (name: string, value: string) => {
      if (name === 'x-request-id') header = value;
    },
  } as unknown as Response;
  const next: NextFunction = jest.fn();
  requestIdMiddleware(req, res, next);
  expect(next).toHaveBeenCalledTimes(1);
  return { req, header };
}

describe('requestIdMiddleware', () => {
  it('honors a valid inbound x-request-id', () => {
    const { req, header } = run('abc-123_DEF');
    expect(req.requestId).toBe('abc-123_DEF');
    expect(header).toBe('abc-123_DEF');
  });

  it('generates a fresh id when none is provided', () => {
    const { req, header } = run();
    expect(req.requestId).toMatch(/^req_[0-9a-f-]{36}$/);
    expect(header).toBe(req.requestId);
  });

  it('regenerates when the inbound id contains CRLF (log injection)', () => {
    const malicious = 'req_x\r\ninjected: true';
    const { req } = run(malicious);
    expect(req.requestId).not.toBe(malicious);
    expect(req.requestId).toMatch(/^req_[0-9a-f-]{36}$/);
  });

  it('regenerates when the inbound id is oversized (>64 chars)', () => {
    const { req } = run('a'.repeat(65));
    expect(req.requestId).toMatch(/^req_[0-9a-f-]{36}$/);
  });

  it('uses the first value when the header arrives as an array', () => {
    const { req } = run(['valid-id', 'second']);
    expect(req.requestId).toBe('valid-id');
  });
});
