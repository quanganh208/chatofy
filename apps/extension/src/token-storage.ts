/**
 * Where this machine's two credentials are kept.
 *
 * `chrome.storage.local`, never `sync`: a bearer credential is this machine's,
 * and carrying it to another one would sign someone in somewhere they never
 * asked to be. The rule matters more for the refresh half than it ever did for
 * the access half — a synced refresh token is a self-renewing credential copied
 * onto every browser the person has signed Chrome into, and it outlives the
 * access token by weeks. Kept out of `CaptureSettings` for the same reason —
 * that object is written back by `saveSettings` every time the popup changes a
 * dropdown, and a credential has no business riding along.
 *
 * Split from `access-token.ts` so the calls there read as what they ask the API
 * rather than as storage bookkeeping. These are the only four places either key
 * is named, which is what makes "both keys, always together" checkable.
 */

const ACCESS_KEY = 'chatofy.accessToken';
const REFRESH_KEY = 'chatofy.refreshToken';

/** Stored strings only. An empty one is treated as absent, never as a credential. */
async function read(key: string): Promise<string | null> {
  const stored = await chrome.storage.local.get(key);
  const value = stored[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export async function loadAccessToken(): Promise<string | null> {
  return read(ACCESS_KEY);
}

export async function loadRefreshToken(): Promise<string | null> {
  return read(REFRESH_KEY);
}

/**
 * Write what the API just answered with.
 *
 * A missing `refreshToken` leaves the stored one alone rather than clearing it.
 * The API's own token shape marks that field optional — a renewal of only the
 * access half is a response it is allowed to give — and reading "absent" as
 * "revoked" would strand a live session with nothing left to renew by.
 */
export async function saveTokens(accessToken: string, refreshToken?: string): Promise<void> {
  const written: Record<string, string> = { [ACCESS_KEY]: accessToken };
  if (refreshToken !== undefined) written[REFRESH_KEY] = refreshToken;
  await chrome.storage.local.set(written);
}

/**
 * Both, in one call.
 *
 * Never one without the other: an access token left behind without its refresh
 * token cannot be renewed, and a refresh token left behind without its access
 * token is a credential nothing on this machine will ever spend or expire.
 */
export async function clearTokens(): Promise<void> {
  await chrome.storage.local.remove([ACCESS_KEY, REFRESH_KEY]);
}
