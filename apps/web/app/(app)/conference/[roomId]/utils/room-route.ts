import type { Route } from 'next';

/**
 * Where the room screen keeps the call to return to after navigating away
 * mid-call. Leaving clears it, and so does any state in which the call is over.
 */
export const ACTIVE_CALL_KEY = 'conference:active';

/** The route segment as a room id; a malformed escape reads as no id at all. */
export function decodeRoomId(segment: string | undefined): string {
  try {
    return decodeURIComponent(segment ?? '');
  } catch {
    return '';
  }
}

/** The end screen of a room — where Leave and an owner-ended meeting land. */
export function endedPath(roomId: string): Route {
  // `as Route`: typedRoutes cannot validate a path built at runtime.
  return `/conference/${encodeURIComponent(roomId)}/ended` as Route;
}
