// Typed error classes for AI provider failures

/**
 * Common base for every provider failure — lets consumers handle all provider
 * errors uniformly (`err instanceof ProviderError`) while still branching on
 * the concrete subtype when the distinction matters.
 */
export abstract class ProviderError extends Error {
  override readonly cause: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.cause = cause;
  }
}

/** Thrown when a provider name is requested but no implementation is registered. */
export class ProviderNotImplementedError extends ProviderError {
  constructor(name: string) {
    super(`Provider "${name}" is not implemented`);
    this.name = 'ProviderNotImplementedError';
  }
}

/**
 * Thrown when a provider receives an invalid or incomplete configuration.
 *
 * Carries a cause because "misconfigured" is not by itself actionable: a key
 * the API rejected as malformed, one whose project has the API disabled, and
 * one blocked by a referrer restriction all arrive here and need different
 * remedies. The underlying rejection is what tells them apart.
 */
export class ProviderConfigError extends ProviderError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'ProviderConfigError';
  }
}

/**
 * Thrown when the transport to a provider fails — the request never produced a
 * response (network failure, DNS, aborted socket). HTTP responses that arrive
 * with an error status belong to ProviderResponseError instead.
 */
export class ProviderConnectionError extends ProviderError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'ProviderConnectionError';
  }
}

/**
 * Thrown when a provider responded but unusably — non-2xx status (bad API key,
 * rate limit, server error) or a body that does not match the expected shape.
 */
export class ProviderResponseError extends ProviderError {
  /** HTTP status when the failure came from an error status; absent for malformed bodies. */
  readonly status?: number;

  constructor(message: string, status?: number, cause?: unknown) {
    super(message, cause);
    this.name = 'ProviderResponseError';
    this.status = status;
  }
}

/**
 * A provider that answered "busy" rather than "broken": its engine was serving
 * another request for longer than this one was allowed to wait.
 *
 * A `ProviderResponseError` (503), so every caller that treats it as a failed
 * response still does. It is its own type because the right answer differs:
 * a live turn that loses the queue should end without audio, not fail after
 * its transcript has already been shown.
 */
export class ProviderBusyError extends ProviderResponseError {
  constructor(message: string) {
    super(message, 503);
    this.name = 'ProviderBusyError';
  }
}

/**
 * Thrown when the CALLER aborted a request it had started — the listener left,
 * the turn ended. Not a fault of the provider, and deliberately not a
 * ProviderConnectionError: reported as a timeout, a client walking away reads
 * as a hung backend in every log and metric that counts failures.
 */
export class ProviderAbortedError extends ProviderError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'ProviderAbortedError';
  }
}
