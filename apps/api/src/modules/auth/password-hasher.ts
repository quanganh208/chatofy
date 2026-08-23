import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

/**
 * An argon2 hash of a value no password equals, verified against when the email
 * is unknown.
 *
 * Without it, "no such user" returns in microseconds while "wrong password"
 * spends a full argon2 verify — a timing difference that answers the exact
 * question the generic error message exists to refuse. The cost of answering
 * every unknown email at argon2 speed is what the route's rate limit bounds.
 *
 * Computed once at module load rather than per request; it hashes a constant, so
 * a fresh one each time would only burn 64 MiB to reach the same conclusion.
 * Module-level rather than a field, so it stays once per PROCESS even if the
 * container ever builds a second instance.
 */
const DUMMY_HASH_PROMISE = argon2
  .hash('a password no account has')
  // Handled at creation, not at first use. Nothing awaits this until the first
  // login for an unknown email, which may never happen — and an unhandled
  // rejection (argon2 failing to load its native binding on a deploy target,
  // the very case this seam exists for) would end the process under Node 24's
  // default --unhandled-rejections=throw. Rethrown on await instead, where it
  // becomes one failed login.
  .catch((err: unknown) => {
    throw err instanceof Error ? err : new Error(String(err));
  });

/**
 * Password hashing, behind one seam.
 *
 * Argon2 is named here and nowhere else, so swapping it for bcryptjs — the
 * fallback if a deploy target cannot build a native module — stays a change to
 * this file alone. Three flows reach it and none of them names the algorithm:
 * registration hashes, reset hashes, login verifies.
 */
@Injectable()
export class PasswordHasher {
  hash(password: string): Promise<string> {
    return argon2.hash(password);
  }

  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      // A stored value argon2 cannot parse is a corrupt row, not a match.
      return false;
    }
  }

  /**
   * The hash to verify against when there is no row — see the note above.
   *
   * A method rather than an exported constant so a caller cannot hold the
   * promise and forget to await it, and so the whole timing defence stays
   * reachable through the one object login already has.
   */
  dummy(): Promise<string> {
    return DUMMY_HASH_PROMISE;
  }
}
