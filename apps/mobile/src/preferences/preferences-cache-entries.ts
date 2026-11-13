/**
 * The serialized shapes the cache keeps, kept apart from SecureStore so the
 * account scoping can be checked without a device.
 *
 * Both values carry the account they belong to: a phone handed to someone else
 * must not show, or send, the previous person's choices.
 */

import { userPreferencesPatchSchema, type UserPreferencesPatch } from '@chatofy/types';

function entryFor(raw: string | null, userId: string): Record<string, unknown> | null {
  if (!raw) return null;
  const entry: unknown = JSON.parse(raw);
  if (typeof entry !== 'object' || entry === null) return null;
  const record = entry as Record<string, unknown>;
  return record['userId'] === userId ? record : null;
}

/** The cached document for `userId`, unparsed, or null for nothing or another account's. */
export function documentFromEntry(raw: string | null, userId: string): unknown {
  return entryFor(raw, userId)?.['preferences'] ?? null;
}

export function documentEntry(userId: string, preferences: unknown): string {
  return JSON.stringify({ userId, preferences });
}

/**
 * The unsent change stored for `userId`. A patch that no longer passes the strict
 * schema (written by another build) is dropped rather than sent: the server would
 * refuse it, and a refused patch would retry forever.
 */
export function pendingFromEntry(raw: string | null, userId: string): UserPreferencesPatch | null {
  const parsed = userPreferencesPatchSchema.safeParse(entryFor(raw, userId)?.['patch']);
  return parsed.success && Object.keys(parsed.data).length > 0 ? parsed.data : null;
}

export function pendingEntry(userId: string, patch: UserPreferencesPatch): string {
  return JSON.stringify({ userId, patch });
}
