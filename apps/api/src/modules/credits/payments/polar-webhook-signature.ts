import { createHmac, timingSafeEqual } from 'node:crypto';

/** Deliveries signed further than this from now are refused (Standard Webhooks' window). */
export const POLAR_TIMESTAMP_TOLERANCE_S = 300;

export type HeaderBag = Record<string, string | string[] | undefined>;

function header(headers: HeaderBag, name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The HMAC keys a Polar endpoint secret may stand for.
 *
 * Polar signs with the Standard Webhooks key — the base64-decoded part after
 * `whsec_` — for secrets it generated on or after 2026-09-08, and with the
 * UTF-8 bytes of the whole secret string for older or user-provided ones. The
 * dashboard does not say which scheme a secret uses, so both are tried; each is
 * a 256-bit-class HMAC key, so accepting either does not weaken the check.
 */
export function polarSigningKeys(secret: string): Buffer[] {
  const keys = [Buffer.from(secret, 'utf8')];
  const encoded = secret.startsWith('whsec_') ? secret.slice(6) : secret;
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    const decoded = Buffer.from(encoded, 'base64');
    if (decoded.length > 0) keys.push(decoded);
  }
  return keys;
}

/**
 * Verifies a Polar (Standard Webhooks) delivery over the RAW body bytes.
 *
 * Signed content is `${webhook-id}.${webhook-timestamp}.${body}`; the
 * `webhook-signature` header is a space-separated list of `v1,<base64>`
 * entries, any one of which may match (a rotated secret signs with both).
 * Every comparison is timing-safe.
 */
export function verifyStandardWebhook(
  rawBody: Buffer,
  headers: HeaderBag,
  secret: string,
  nowMs = Date.now(),
): boolean {
  const id = header(headers, 'webhook-id');
  const timestamp = header(headers, 'webhook-timestamp');
  const signatures = header(headers, 'webhook-signature');
  if (!id || !timestamp || !signatures || !/^\d{1,12}$/.test(timestamp)) {
    return false;
  }
  if (
    Math.abs(nowMs / 1000 - Number(timestamp)) > POLAR_TIMESTAMP_TOLERANCE_S
  ) {
    return false;
  }
  const signed = Buffer.concat([
    Buffer.from(`${id}.${timestamp}.`, 'utf8'),
    rawBody,
  ]);
  const expected = polarSigningKeys(secret).map((key) =>
    createHmac('sha256', key).update(signed).digest(),
  );
  return signatures.split(' ').some((entry) => {
    const [version, signature] = entry.split(',');
    if (version !== 'v1' || !signature) return false;
    const provided = Buffer.from(signature, 'base64');
    return expected.some(
      (candidate) =>
        candidate.length === provided.length &&
        timingSafeEqual(candidate, provided),
    );
  });
}
