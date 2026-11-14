/**
 * An invite token the `/invite` page took out of its URL, kept until it is used.
 *
 * localStorage, not sessionStorage: a brand-new invitee registers, then opens the
 * verify link from their mail in a NEW tab, and sessionStorage is per tab, so the
 * token would be lost on exactly the path this exists for. The entry is ignored
 * after 7 days, the invite's own lifetime, and cleared once the invite is used or
 * reaches any final status. A leftover entry on a shared device is useless to
 * anyone else: accept is bound to the invited mailbox's account.
 */
const PENDING_INVITE_KEY = 'chatofy.pendingInvite';

/** 32 random bytes in base64url, as the API mints them. */
export const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function savePendingInvite(token: string): void {
  try {
    localStorage.setItem(PENDING_INVITE_KEY, JSON.stringify({ token, savedAt: Date.now() }));
  } catch {
    // Storage refused: the invite can still be opened again from the mail.
  }
}

function readEntry(): { token: string; savedAt: number; parked: boolean } | null {
  try {
    const raw = localStorage.getItem(PENDING_INVITE_KEY);
    if (!raw) return null;
    const entry: unknown = JSON.parse(raw);
    if (!entry || typeof entry !== 'object') return null;
    const { token, savedAt, parked } = entry as Record<string, unknown>;
    if (typeof token !== 'string' || !INVITE_TOKEN_PATTERN.test(token)) return null;
    if (typeof savedAt !== 'number' || Date.now() - savedAt > MAX_AGE_MS) return null;
    return { token, savedAt, parked: parked === true };
  } catch {
    return null;
  }
}

/** The stored token, or null when absent, malformed or older than 7 days. */
export function readPendingInvite(): string | null {
  return readEntry()?.token ?? null;
}

/**
 * Whether a fresh sign-in should be sent to `/invite`: an invite is stored and is
 * not parked. A parked invite (the team is full, or the invitee is at the team cap)
 * stays readable on `/invite`, but no longer pulls every later sign-in on this
 * device back to a page that can only say no.
 */
export function hasInviteAwaitingSignIn(): boolean {
  const entry = readEntry();
  return entry !== null && !entry.parked;
}

/** Keep the invite for `/invite`, but stop it steering later sign-ins there. */
export function parkPendingInvite(): void {
  const entry = readEntry();
  if (!entry) return;
  try {
    localStorage.setItem(PENDING_INVITE_KEY, JSON.stringify({ ...entry, parked: true }));
  } catch {
    // Storage refused: the entry stays as it was.
  }
}

export function clearPendingInvite(): void {
  try {
    localStorage.removeItem(PENDING_INVITE_KEY);
  } catch {
    // Nothing that could be read back.
  }
}

/**
 * Take the token out of the URL before anything else runs, so it sits in the
 * address bar and history for no longer than this read. Runs in the state
 * initializer rather than an effect: the first client render already knows the
 * token, and repeating it is harmless (the URL is stripped, the save is the same).
 */
export function takeInviteFromUrl(fromUrl: string | null): string | null | undefined {
  if (typeof window === 'undefined') return undefined;
  if (fromUrl !== null) {
    window.history.replaceState(null, '', '/invite');
    // A malformed link is that link's answer: it must not fall back to an older
    // invite this device still holds.
    if (!INVITE_TOKEN_PATTERN.test(fromUrl)) return null;
    savePendingInvite(fromUrl);
  }
  return readPendingInvite();
}
