import type { ApiError } from '@chatofy/types';

/**
 * Thrown when the API returns a well-formed ERROR envelope
 * (`{ success: false, error, meta }`). Carries the structured error payload
 * and the HTTP status, so callers can branch on `error.code`.
 */
export class ApiClientError extends Error {
  constructor(
    public readonly error: ApiError,
    public readonly status: number,
  ) {
    super(error.message);
    this.name = 'ApiClientError';
  }
}

/**
 * Thrown when the response body does not match the contract — a deploy-skew
 * signal (the API changed shape vs the client's schemas). Distinct from
 * ApiClientError so monitoring can tell "API said no" from "API drifted".
 */
export class ContractError extends Error {
  constructor(
    public readonly issues: unknown,
    public readonly raw: unknown,
  ) {
    super('Response did not match the API contract');
    this.name = 'ContractError';
  }
}

/**
 * Thrown when the request never produced a usable response at the transport
 * level — network failure or client-side timeout. Completes the typed failure
 * set: ApiClientError (API said no), ContractError (API drifted), NetworkError
 * (API unreachable/slow), so callers never see a raw TypeError/AbortError.
 */
export class NetworkError extends Error {
  override readonly cause: unknown;

  constructor(
    message: string,
    /** True when the client-side timeout fired (fetch or body read). */
    public readonly timedOut: boolean,
    cause?: unknown,
  ) {
    super(message);
    this.name = 'NetworkError';
    this.cause = cause;
  }
}
