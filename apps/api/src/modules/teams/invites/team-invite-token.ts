import { createHash, randomBytes } from 'node:crypto';

/**
 * Invite tokens: 32 random bytes, base64url (43 characters). Only the sha256
 * hex of a token is ever stored, in `TeamInvite.tokenHash`, so a database
 * read cannot recover a usable link. Single-use is a property of the row
 * (`acceptedAt`), not of the token, which is why the stateless purpose tokens
 * the auth module signs are not used here.
 */
export function mintInviteToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashInviteToken(token) };
}

/** The stored form of a token: sha256, hex (64 characters). */
export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
