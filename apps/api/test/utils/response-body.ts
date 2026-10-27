import type { Response } from 'supertest';
import type { z } from 'zod';
import {
  apiErrorResponseSchema,
  apiSuccessSchema,
  type ApiErrorResponse,
  type ApiSuccess,
} from '@chatofy/types';

/**
 * Reads a supertest body as the shared contract says it is shaped.
 *
 * supertest types `res.body` as `any`, so every `res.body.data.x` was a read no
 * compiler checked. Going through the zod schema the clients themselves parse
 * with means a field the contract drops, or a test reading one the contract
 * never had, fails here instead of passing on `undefined`.
 *
 * The body is VALIDATED and then returned as received, not as parsed. A zod
 * object strips unknown keys and fills defaults, so handing back the parse
 * output would let an exact `toEqual`, or a check that a field must NOT leak
 * (a password hash, an internal timestamp), pass on a key the API really sent.
 * That is also why the type is the schema's input side: a defaulted field may
 * be absent on the wire.
 */
export function readBody<S extends z.ZodType>(
  res: Response,
  schema: S,
): z.input<S> {
  schema.parse(res.body);
  // Validated on the line above; the cast only names what the parse proved.
  return res.body as z.input<S>;
}

/** A success envelope whose `data` matches `data`. */
export function successBody<T extends z.ZodType>(
  res: Response,
  data: T,
): ApiSuccess<z.input<T>> {
  // Not `readBody`: zod cannot resolve its input type for a generic `T`, so
  // the envelope is spelled with the hand-written alias the contract keeps
  // drift-guarded against the factory.
  apiSuccessSchema(data).parse(res.body);
  return res.body as ApiSuccess<z.input<T>>;
}

/** An error envelope: `success: false`, a known code, and the request meta. */
export function errorBody(res: Response): ApiErrorResponse {
  return readBody(res, apiErrorResponseSchema);
}
