import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/** Valid client-supplied request id: short, alnum + dash/underscore only. */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Assigns a correlation id to every HTTP request.
 *
 * An inbound `x-request-id` is honored ONLY when it matches a strict pattern;
 * otherwise a fresh `req_<uuid>` is generated. This prevents log injection /
 * header reflection of attacker-controlled CRLF or oversized header values.
 *
 * Registered globally via `app.use()` (Express 5 rejects `forRoutes('*')`).
 */
export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const inbound = req.headers[REQUEST_ID_HEADER];
  const candidate = Array.isArray(inbound) ? inbound[0] : inbound;
  const requestId =
    candidate && REQUEST_ID_PATTERN.test(candidate)
      ? candidate
      : `req_${randomUUID()}`;

  req.requestId = requestId;
  res.setHeader(REQUEST_ID_HEADER, requestId);
  next();
}
