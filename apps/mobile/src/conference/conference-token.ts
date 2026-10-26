/**
 * Where the conference WebSocket's auth token comes from — isolated here so the
 * route and the hook never embed an auth mechanism inline.
 *
 * It is the signed-in session's access token. The `/ws/conference` gateway
 * validates it at the HTTP upgrade, so a token is genuinely required: with nobody
 * signed in this throws, and the hook shows the `not-authenticated` state rather
 * than attempting a join the gateway would refuse.
 */

import { authClient } from '@/clients/auth-client';
import { SignedOutError } from '@/clients/auth-client.interface';

/** Thrown when nobody is signed in, or the session has ended. */
export class ConferenceAuthUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConferenceAuthUnavailableError';
  }
}

/**
 * Resolve a fresh access token for the conference socket or its REST calls.
 * Called once per connection attempt, so a reconnect late in a call never
 * presents an expired token: the client renews the pair first when it must.
 *
 * @throws ConferenceAuthUnavailableError when signed out; any other error when
 * renewal failed transiently (the session is kept, and the next attempt retries).
 */
export async function getConferenceToken(): Promise<string> {
  try {
    return await authClient.getAccessToken();
  } catch (err) {
    if (err instanceof SignedOutError) throw new ConferenceAuthUnavailableError(err.message);
    throw err;
  }
}
