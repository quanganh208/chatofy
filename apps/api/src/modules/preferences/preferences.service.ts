import {
  BadRequestException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import {
  PREFERENCES_LIMITS,
  defaultUserPreferences,
  mergePreferences,
  parseUserPreferences,
  preferencesByteLength,
  userPreferencesSchema,
  type PreferencesResponse,
  type UserPreferences,
  type UserPreferencesPatch,
} from '@chatofy/types';
import {
  USER_PREFERENCES_STORE,
  type StoredPreferences,
  type UserPreferencesStore,
} from './interfaces/user-preferences-store.interface';

/**
 * One account's preferences document: read tolerantly, written strictly.
 *
 * Reads go through `parseUserPreferences` over the account's defaults, so a
 * field an older or newer build stored in a shape this one cannot read costs
 * that field, never the whole document. Writes are the opposite: the patch is
 * merged over the stored document and the RESULT must pass the whole schema and
 * the byte cap, or nothing is written — a client cannot store a state another
 * client cannot represent.
 */
@Injectable()
export class PreferencesService {
  constructor(
    @Inject(USER_PREFERENCES_STORE)
    private readonly store: UserPreferencesStore,
  ) {}

  async get(userId: string): Promise<PreferencesResponse> {
    return toResponse(present(await this.store.read(userId)));
  }

  async update(
    userId: string,
    patch: UserPreferencesPatch,
  ): Promise<PreferencesResponse> {
    const saved = await this.store.update(userId, (current) =>
      checked(mergePreferences(documentOf(current), patch)),
    );
    return toResponse(present(saved));
  }

  /** Reset to defaults: the row goes, and the defaults come back. */
  async reset(userId: string): Promise<PreferencesResponse> {
    return toResponse(present(await this.store.reset(userId)));
  }
}

/** A token outliving its account reads as an invalid token, as on `/auth/me`. */
function present(stored: StoredPreferences | null): StoredPreferences {
  if (!stored) throw new UnauthorizedException('Invalid token');
  return stored;
}

function documentOf(stored: StoredPreferences): UserPreferences {
  return parseUserPreferences(
    stored.data,
    defaultUserPreferences(stored.locale),
  );
}

function toResponse(stored: StoredPreferences): PreferencesResponse {
  return {
    preferences: documentOf(stored),
    updatedAt: stored.updatedAt?.toISOString() ?? null,
  };
}

/**
 * The merged document, or a 400 saying why it cannot be stored.
 *
 * The body already passed the patch schema at the pipe, so the whole-document
 * check can only fail on what the patch could not see on its own — today, the
 * byte cap, which `reading` (an open object merged one level) is the one field
 * able to grow past. The schema pass stays anyway: it is the invariant that
 * every stored row is a valid document, and it costs microseconds.
 */
function checked(merged: UserPreferences): UserPreferences {
  const parsed = userPreferencesSchema.safeParse(merged);
  if (!parsed.success) {
    throw new BadRequestException(
      'These preferences cannot be saved: the result is not a valid document.',
    );
  }
  const bytes = preferencesByteLength(parsed.data);
  if (bytes > PREFERENCES_LIMITS.MAX_DOCUMENT_BYTES) {
    throw new BadRequestException(
      `These preferences are too large to save (${bytes} bytes; the limit is ` +
        `${PREFERENCES_LIMITS.MAX_DOCUMENT_BYTES}).`,
    );
  }
  return parsed.data;
}
