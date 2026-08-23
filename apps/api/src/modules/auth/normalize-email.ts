/**
 * The form an address is stored and compared in.
 *
 * Neither `z.email()` nor Postgres's default collation folds case, so without
 * this someone who registers `Alice@corp.com` cannot log in as
 * `alice@corp.com` — they get the generic failure, indistinguishable from a
 * wrong password, with no way to find out why. Worse for Google: the lookup
 * misses the row entirely and silently creates a SECOND account for the same
 * person.
 *
 * Applied at the service boundary rather than in the shared request schema, so
 * the wire contract keeps describing what a client may send while the services
 * own what identity means. Only the domain would be case-insensitive by RFC; the
 * local part is folded too because every provider this targets treats it that
 * way and a split identity is the worse failure.
 *
 * A free function in its own file rather than a method: registration, recovery
 * and sign-in all need it, and identity must mean the same thing in all three.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
