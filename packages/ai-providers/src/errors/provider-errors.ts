// Typed error classes for AI provider failures

/** Thrown when a provider name is requested but no implementation is registered. */
export class ProviderNotImplementedError extends Error {
  constructor(name: string) {
    super(`Provider "${name}" is not implemented`);
    this.name = 'ProviderNotImplementedError';
  }
}

/** Thrown when a provider receives an invalid or incomplete configuration. */
export class ProviderConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderConfigError';
  }
}

/** Thrown when a provider cannot establish or maintain a connection. */
export class ProviderConnectionError extends Error {
  override readonly cause: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'ProviderConnectionError';
    this.cause = cause;
  }
}
