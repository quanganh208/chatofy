import { HttpException } from '@nestjs/common';
import type { ApiError, ErrorCode } from '@chatofy/types';

/** The codes that name a state of their own rather than a generic status. */
export type CodedHttpErrorCode = Extract<
  ErrorCode,
  'CREDITS_EXHAUSTED' | 'CHECKOUT_NOT_OPEN' | 'INVITE_NOT_PENDING'
>;

/**
 * An HTTP refusal whose client-facing code is not the one its status implies.
 *
 * `AllExceptionsFilter` derives a code from the status, so a plain
 * `ForbiddenException` always reaches a client as `FORBIDDEN` — and "checkout is
 * not open to you yet" is not a permissions fault the client should treat as
 * one. Likewise 402 has no code of its own there and would read as
 * `VALIDATION_FAILED`, "fix your request", when the fix is to get more credits.
 * The filter recognises this class by class, ahead of its generic branch, and
 * emits `code` and the status unchanged.
 *
 * The message is client-facing, like every 4xx message: never put internal or
 * database text in it.
 *
 * `details`, when given, reaches the error body as written, so a client can
 * read a machine state (an invite's status) without matching message text.
 */
export class CodedHttpException extends HttpException {
  constructor(
    readonly code: CodedHttpErrorCode,
    status: number,
    message: string,
    readonly details?: ApiError['details'],
  ) {
    super(message, status);
  }
}
