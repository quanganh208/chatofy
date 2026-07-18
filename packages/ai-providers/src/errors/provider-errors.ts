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

/** Thrown when a provider receives an invalid or incomplete configuration. */
export class ProviderConfigError extends ProviderError {
  constructor(message: string) {
    super(message);
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
