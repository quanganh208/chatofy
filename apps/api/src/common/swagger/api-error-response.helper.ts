import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import type { ErrorCode } from '@chatofy/types';
import { ApiErrorResponseDto } from './envelope.dto';

/**
 * What each documented failure status means to a client, written from the
 * caller's side: the status, the `error.code` it carries, and what to do about
 * it. Keyed by status because that is what a caller branches on first.
 *
 * The codes here are the ones `AllExceptionsFilter.codeForStatus` actually
 * emits — this table is documentation OF that mapping, not a second opinion on
 * it, so a status added here must exist there too.
 */
const ERROR_RESPONSES: Record<
  number,
  { code: ErrorCode; description: string }
> = {
  400: {
    code: 'VALIDATION_FAILED',
    description:
      'The body or query failed schema validation. `error.details` names each offending field and why it was rejected.',
  },
  401: {
    code: 'UNAUTHORIZED',
    description:
      'The bearer token is missing, expired, malformed, or was issued before a password reset. Sign in again.',
  },
  403: {
    code: 'FORBIDDEN',
    description: 'Authenticated, but not allowed to do this.',
  },
  404: { code: 'NOT_FOUND', description: 'No such resource.' },
  409: {
    code: 'CONFLICT',
    description: 'The request conflicts with existing state.',
  },
  413: {
    code: 'VALIDATION_FAILED',
    description:
      'The body is larger than the ceiling for this path. Refused by the parser before the route ran, so no field was inspected — send less rather than changing the shape.',
  },
  415: {
    code: 'VALIDATION_FAILED',
    description:
      'The body is not a media type this route stores. Decided by SNIFFING the bytes, not by the `Content-Type` header — a declared type is a claim — so relabelling the request will not change the answer. Send a different recording.',
  },
  429: {
    code: 'RATE_LIMITED',
    description:
      'Too many requests from this client address. The request was never inspected — resend it later rather than changing it.',
  },
  503: {
    code: 'INTERNAL_ERROR',
    description:
      'A dependency this route needs is unreachable — the request was never decided, so RESEND it rather than treating it as an answer. Notably NOT 401: a client that signs a user out on this has turned an outage into a forced logout it cannot recover from. `error.message` is generic like every 5xx; correlate with `meta.requestId`.',
  },
  500: {
    code: 'INTERNAL_ERROR',
    description:
      'Unexpected server fault. `error.message` is always generic; correlate with `meta.requestId` (echoed as the `x-request-id` header) to find it in the logs.',
  },
};

/**
 * Documents the failure statuses a route can answer with, each as the standard
 * error envelope.
 *
 * Exists because the success envelope alone is a half-written contract: a
 * client generated from a document that lists only 200 has no type for the
 * body it gets on a 401, and the shape differs (`error`, not `data`). Applied
 * per route rather than globally so the listed statuses stay true of THAT
 * route — a public route does not answer 401, and an unthrottled one does not
 * answer 429.
 *
 * 500 is added to every call automatically: any route can fault.
 */
export function ApiErrorResponses(
  ...statuses: number[]
): MethodDecorator & ClassDecorator {
  const withInternal = statuses.includes(500) ? statuses : [...statuses, 500];
  return applyDecorators(
    ...withInternal.map((status) => {
      const entry = ERROR_RESPONSES[status];
      if (entry === undefined) {
        throw new Error(
          `ApiErrorResponses: status ${status} has no documented error code`,
        );
      }
      return ApiResponse({
        status,
        description: `\`${entry.code}\` — ${entry.description}`,
        type: ApiErrorResponseDto,
      });
    }),
  );
}
