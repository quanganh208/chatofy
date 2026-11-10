import { createHmac, timingSafeEqual } from 'node:crypto';
import type { HeaderBag } from './polar-webhook-signature';

/** SePay's own replay window: timestamps further than this from now are refused. */
export const SEPAY_TIMESTAMP_TOLERANCE_S = 300;

function header(headers: HeaderBag, name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Verifies a SePay webhook signed with HMAC-SHA256.
 *
 * SePay sends `X-SePay-Signature: sha256=<hex>` over `"{timestamp}.{raw body}"`
 * and `X-SePay-Timestamp: <unix seconds>`. The body is verified as the bytes
 * that arrived, never re-serialised JSON, and compared timing-safely.
 * Node lower-cases header names, so they are read in lower case.
 */
export function verifySepayHmac(
  rawBody: Buffer,
  headers: HeaderBag,
  secret: string,
  nowMs = Date.now(),
): boolean {
  const signature = header(headers, 'x-sepay-signature');
  const timestamp = header(headers, 'x-sepay-timestamp');
  if (!signature || !timestamp || !/^\d{1,12}$/.test(timestamp)) return false;
  if (
    Math.abs(nowMs / 1000 - Number(timestamp)) > SEPAY_TIMESTAMP_TOLERANCE_S
  ) {
    return false;
  }
  const expected = Buffer.from(
    'sha256=' +
      createHmac('sha256', secret)
        .update(Buffer.concat([Buffer.from(`${timestamp}.`, 'utf8'), rawBody]))
        .digest('hex'),
    'utf8',
  );
  const provided = Buffer.from(signature, 'utf8');
  return (
    provided.length === expected.length && timingSafeEqual(provided, expected)
  );
}
