// Standard API response envelope — single contract shared by api, mobile, web.
// Schema-first: zod schemas are the source of truth; TS types are inferred.
// Every HTTP response (except infra probes like /health) conforms to ApiResponse<T>.
import { z } from 'zod';

/** Stable, machine-readable error codes. Inferred union (no runtime enum). */
export const errorCodeSchema = z.enum([
  'VALIDATION_FAILED',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

/** Pagination metadata — present in meta only on list endpoints. */
export const paginationSchema = z.object({
  page: z.number(),
  limit: z.number(),
  total: z.number(),
  totalPages: z.number(),
});
export type Pagination = z.infer<typeof paginationSchema>;

/** Envelope metadata — present on every enveloped response. */
export const apiMetaSchema = z.object({
  /** Correlation id, echoed in the x-request-id response header and logs. */
  requestId: z.string(),
  /** ISO-8601 timestamp of when the response was produced. */
  timestamp: z.string(),
  /** Only set on list endpoints. */
  pagination: paginationSchema.optional(),
});
export type ApiMeta = z.infer<typeof apiMetaSchema>;

/** Structured error payload. `details` carries field-level validation issues. */
export const apiErrorSchema = z.object({
  code: errorCodeSchema,
  message: z.string(),
  details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

/** Error response envelope (carried with a real 4xx/5xx HTTP status). */
export const apiErrorResponseSchema = z.object({
  success: z.literal(false),
  error: apiErrorSchema,
  meta: apiMetaSchema,
});
export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;

/**
 * Success-envelope schema factory. Built per data schema.
 * Consumers that parse per request MUST memoize the result — building a fresh
 * schema on every call allocates a new object graph.
 */
export const apiSuccessSchema = <T extends z.ZodType>(data: T) =>
  z.object({ success: z.literal(true), data, meta: apiMetaSchema });

/**
 * Discriminated union of every enveloped API response for a given data schema.
 * Branch on `success`. Same memoization caveat as `apiSuccessSchema`.
 */
export const apiResponseSchema = <T extends z.ZodType>(data: T) =>
  z.discriminatedUnion('success', [apiSuccessSchema(data), apiErrorResponseSchema]);

// Ergonomic generic TYPE helpers. Kept as hand-written aliases because the
// factory's inferred generic type is unwieldy to spell at call sites. The
// drift guard below makes these provably equivalent to the factory's output.
export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta: ApiMeta;
}
export type ApiResponse<T> = ApiSuccess<T> | ApiErrorResponse;

// --- Drift guard (type-level, emits no runtime code) -----------------------
// If the hand-written ApiSuccess<T> ever diverges from what apiSuccessSchema
// actually infers, `_EnvelopeInSync` fails to satisfy `true` and the build
// breaks here — the two declarations cannot silently drift.
type _Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type _Assert<T extends true> = T;
type _SuccessInfer<T extends z.ZodType> = z.infer<ReturnType<typeof apiSuccessSchema<T>>>;
type _EnvelopeInSync = _Assert<_Equal<ApiSuccess<string>, _SuccessInfer<z.ZodString>>>;
