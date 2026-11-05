/**
 * Pure rules for who may see which part of the app, kept apart from the router
 * so they can be tested without one.
 */

/**
 * `next` after sign-in is honoured only when it is an in-app path. A crafted
 * link such as `chatofy://sign-in?next=//evil` or `next=https://evil` must not
 * send the user elsewhere, so protocol-relative and absolute URLs fall back.
 */
export function safeNextPath(next: unknown, fallback: string): string {
  if (typeof next !== 'string') return fallback;
  if (!next.startsWith('/') || next.startsWith('//')) return fallback;
  // A backslash is read as a slash by some URL parsers.
  if (next.includes('\\')) return fallback;
  return next;
}

export interface AppGuardInput {
  /** The stored session is still being read; nobody is judged until it is. */
  isLoading: boolean;
  signedIn: boolean;
  /** The path the user is on, for coming back to it after signing in. */
  pathname: string;
}

/**
 * Where a signed-out visitor to the signed-in area should go, or null to stay.
 * While the session loads the answer is "stay": redirecting then would sign
 * everyone out of view for the moment it takes SecureStore to answer.
 */
export function appGuardRedirect({ isLoading, signedIn, pathname }: AppGuardInput): string | null {
  if (isLoading || signedIn) return null;
  const next = safeNextPath(pathname, '/translate');
  return `/sign-in?next=${encodeURIComponent(next)}`;
}

/** The first screen of a cold start: the app for a session, sign-in without one. */
export function entryRedirect(signedIn: boolean): string {
  return signedIn ? '/translate' : '/sign-in';
}
