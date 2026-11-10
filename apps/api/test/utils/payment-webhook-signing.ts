import { createHmac, randomBytes } from 'node:crypto';

// Signs webhook fixtures the way each provider documents it, written out here
// rather than borrowed from the verifiers, so a spec that signs with this and
// verifies with the app's code checks the app against the documented algorithm,
// not against itself.

/** A Standard Webhooks secret as Polar issues it since 2026-09-08: `whsec_` + base64 key. */
export function newPolarSecret(): string {
  return `whsec_${randomBytes(32).toString('base64')}`;
}

/**
 * Polar's headers for `body`.
 *
 * `scheme: 'standard'` keys the HMAC with the base64-decoded part after
 * `whsec_` (secrets Polar generated on or after 2026-09-08); `'legacy'` keys it
 * with the UTF-8 bytes of the whole secret (older or user-provided secrets).
 */
export function polarHeaders(
  body: string,
  secret: string,
  options: {
    id?: string;
    timestamp?: number;
    scheme?: 'standard' | 'legacy';
  } = {},
): Record<string, string> {
  const id = options.id ?? `msg_${randomBytes(8).toString('hex')}`;
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);
  const key =
    (options.scheme ?? 'standard') === 'standard'
      ? Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
      : Buffer.from(secret, 'utf8');
  const signature = createHmac('sha256', key)
    .update(`${id}.${timestamp}.${body}`)
    .digest('base64');
  return {
    'webhook-id': id,
    'webhook-timestamp': String(timestamp),
    'webhook-signature': `v1,${signature}`,
  };
}

/** SePay's HMAC-SHA256 headers: `sha256=hex(HMAC(secret, "{ts}.{body}"))`. */
export function sepayHeaders(
  body: string,
  secret: string,
  timestamp = Math.floor(Date.now() / 1000),
): Record<string, string> {
  const signature = createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest('hex');
  return {
    'x-sepay-signature': `sha256=${signature}`,
    'x-sepay-timestamp': String(timestamp),
  };
}
