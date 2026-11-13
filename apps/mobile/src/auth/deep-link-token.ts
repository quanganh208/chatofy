/**
 * Reads the token an app link carries (`chatofy://verify-email?token=…`).
 *
 * The router hands screens their query values as `string | string[]`; a link
 * that was cut short or tampered with yields neither a string nor one of a
 * plausible length, and the screen then asks for the link again instead of
 * sending a request the API would refuse. The length bounds are the API's
 * (`linkTokenSchema`), so this never rejects a token the API would take.
 */

import { AUTH_LIMITS } from '@chatofy/types';

export function readLinkToken(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const token = value.trim();
  if (token.length < AUTH_LIMITS.minToken || token.length > AUTH_LIMITS.maxToken) return null;
  return token;
}
