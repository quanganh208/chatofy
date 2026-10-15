/**
 * Where the conference WebSocket's auth token comes from — isolated here so the
 * route and the hook never embed an auth mechanism inline.
 *
 * KNOWN LIMITATION (Phase 1). The mobile app's `AuthClient` is still a throwing
 * stub (src/clients/auth-client.stub.ts), so there is no real signed-in session to
 * read a token from yet. The `/ws/conference` gateway DOES validate this token at
 * the HTTP upgrade (apps/api .../translate/ws-auth.ts → `createVerifyClient`), so a
 * token is genuinely required — it cannot be skipped. Until a concrete AuthClient
 * lands, this logs in with bench credentials from the Expo env and returns the
 * access token. The dependency on `EXPO_PUBLIC_BENCH_*` lives ONLY here; when a real
 * token source exists, swap this one function's body and nothing else changes.
 */

const API_BASE = process.env['EXPO_PUBLIC_API_BASE_URL'] ?? 'http://10.0.2.2:3000';

/**
 * Resolve an access token for the conference socket.
 *
 * @throws if bench credentials are absent or the login request fails — the caller
 * (the hook) maps a throw to the `not-authenticated` error state rather than
 * attempting an unauthenticated join the gateway would refuse anyway.
 */
export async function getConferenceToken(): Promise<string> {
  const email = process.env['EXPO_PUBLIC_BENCH_EMAIL'] ?? '';
  const password = process.env['EXPO_PUBLIC_BENCH_PASSWORD'] ?? '';
  if (!email || !password) {
    throw new Error(
      'No conference auth token source. Set EXPO_PUBLIC_BENCH_EMAIL and ' +
        'EXPO_PUBLIC_BENCH_PASSWORD in apps/mobile/.env, or wire a real AuthClient.',
    );
  }

  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`Conference login failed: ${res.status}`);

  const json = (await res.json()) as { data: { token: { accessToken: string } } };
  return json.data.token.accessToken;
}
