/**
 * Where the conference WebSocket's auth token comes from — isolated here so the
 * route and the hook never embed an auth mechanism inline.
 *
 * KNOWN LIMITATION. The mobile app's `AuthClient` is still a throwing stub
 * (src/clients/auth-client.stub.ts), so there is no real signed-in session to read
 * a token from yet. The `/ws/conference` gateway validates this token at the HTTP
 * upgrade, so a token is genuinely required. Until a concrete AuthClient lands, a
 * DEVELOPMENT build logs in with bench credentials from the Expo env and returns
 * the access token.
 *
 * A release build fails closed: it throws before touching `EXPO_PUBLIC_BENCH_*`,
 * so the hook shows the `not-authenticated` state and no credential is ever read
 * (the conference screens are also unreachable outside `__DEV__`). When a real
 * token source exists, swap this one function's body and nothing else changes.
 */

import { API_BASE_URL } from './conference-config';

/** Thrown when there is no token source this build is allowed to use. */
export class ConferenceAuthUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConferenceAuthUnavailableError';
  }
}

/**
 * Resolve a fresh access token for the conference socket or its REST calls.
 * Called once per connection attempt, so a reconnect late in a call never
 * presents an expired token.
 *
 * @throws ConferenceAuthUnavailableError in a release build, or when bench
 * credentials are absent; Error when the login request fails. The hook maps any
 * throw to the `not-authenticated` state rather than attempting an
 * unauthenticated join the gateway would refuse anyway.
 */
export async function getConferenceToken(): Promise<string> {
  if (!__DEV__) {
    throw new ConferenceAuthUnavailableError(
      'Conference sign-in is only available in development builds.',
    );
  }

  const email = process.env['EXPO_PUBLIC_BENCH_EMAIL'] ?? '';
  const password = process.env['EXPO_PUBLIC_BENCH_PASSWORD'] ?? '';
  if (!email || !password) {
    throw new ConferenceAuthUnavailableError(
      'No conference auth token source. Set EXPO_PUBLIC_BENCH_EMAIL and ' +
        'EXPO_PUBLIC_BENCH_PASSWORD in apps/mobile/.env, or wire a real AuthClient.',
    );
  }

  const res = await fetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`Conference login failed: ${res.status}`);

  const json = (await res.json()) as { data?: { token?: { accessToken?: unknown } } };
  const accessToken = json.data?.token?.accessToken;
  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    throw new Error('Conference login returned no access token');
  }
  return accessToken;
}
