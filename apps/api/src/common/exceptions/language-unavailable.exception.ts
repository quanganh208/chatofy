import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * A capability this deployment genuinely does not have right now — no engine
 * configured serves the language a turn or a `/translate` call needs.
 *
 * 503, not 400: the caller did nothing wrong, so "fix your request" is the
 * wrong sentence to send it. It is not an unexpected fault either — every
 * other 5xx `AllExceptionsFilter` sees is masked to a generic "Internal
 * server error", which is right for a dependency that broke but wrong here:
 * the message IS the useful part, naming which language to ask for instead,
 * and it is the identical sentence the WS path already sends as its own
 * `language_unavailable` event. `AllExceptionsFilter` recognises this class
 * specifically and leaves its message and its `SERVICE_UNAVAILABLE` code
 * alone rather than folding it into the generic 5xx branch.
 */
export class LanguageUnavailableException extends HttpException {
  constructor(message: string) {
    super(message, HttpStatus.SERVICE_UNAVAILABLE);
  }
}
