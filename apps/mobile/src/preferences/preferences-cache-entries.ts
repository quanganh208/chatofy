/**
 * The serialized shapes the cache keeps, kept apart from SecureStore so the
 * account scoping can be checked without a device.
 *
 * Both values carry the account they belong to: a phone handed to someone else
 * must not show, or send, the previous person's choices.
 */

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
 * The unsent changes stored for `userId`, as the sync store wrote them, or null
 * for nothing or another account's. Opaque here: the store reads it back
 * through the strict patch schema and drops whatever no longer passes.
 */
export function pendingFromEntry(raw: string | null, userId: string): unknown {
  return entryFor(raw, userId)?.['pending'] ?? null;
}

export function pendingEntry(userId: string, pending: unknown): string {
  return JSON.stringify({ userId, pending });
}
