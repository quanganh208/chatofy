// Backend-agnostic store for an account's preferences document, following the
// TRANSLATION_CONTEXT_STORE seam: the interface is what lets the service and
// controller specs run over an in-memory double, and what keeps Prisma types out
// of the service.
import type { UserPreferences } from '@chatofy/types';

/** DI injection token for the preferences store. */
export const USER_PREFERENCES_STORE = Symbol('USER_PREFERENCES_STORE');

/**
 * What the store knows about one account's preferences.
 *
 * `data` is `unknown` on purpose: it is a JSONB column, so it holds whatever a
 * past build wrote, and only `parseUserPreferences` decides what of it is still
 * readable. `null` together with a null `updatedAt` means no row — the account
 * holds only defaults.
 *
 * `locale` travels with it because the defaults are derived from it, and reading
 * it in the same statement as the row means a GET is one round trip.
 */
export interface StoredPreferences {
  locale: string;
  data: unknown;
  updatedAt: Date | null;
}

/**
 * Every method is scoped by `userId` — the authenticated caller, read from the
 * verified token and never from the request. Each answers `null` when that user
 * no longer exists (deleted after the token was issued).
 */
export interface UserPreferencesStore {
  read(userId: string): Promise<StoredPreferences | null>;

  /**
   * Read, compute and write the document as ONE atomic step.
   *
   * `next` receives the current state and returns the document to store; it
   * may throw to refuse the write, in which case nothing is written and the
   * error propagates. An implementation must make concurrent calls for one user
   * see each other's results — two devices patching different fields at once
   * must both survive — so the read cannot be a snapshot another write can slip
   * past.
   */
  update(
    userId: string,
    next: (current: StoredPreferences) => UserPreferences,
  ): Promise<StoredPreferences | null>;

  /**
   * Empty the document (`data: {}`) under the same lock as `update`, so its
   * `updatedAt` moves forward. Clients use it as a version and must never see
   * it go back to a value it held before.
   */
  reset(userId: string): Promise<StoredPreferences | null>;
}
