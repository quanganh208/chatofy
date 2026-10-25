/**
 * REST calls for conference rooms. A room exists only once `POST /conference`
 * has minted it; the lobby navigates to the id this returns.
 */

import { apiSuccessSchema, conferenceResponseSchema } from '@chatofy/types/http';
import { API_BASE_URL } from './conference-config';
import { getConferenceToken } from './conference-token';

// Memoized once: the factory allocates a new schema graph per call.
const createConferenceResponseSchema = apiSuccessSchema(conferenceResponseSchema);

/** Why creating a room failed, so the lobby can pick the right copy. */
export class CreateConferenceRoomError extends Error {
  constructor(
    readonly kind: 'not-authenticated' | 'failed',
    message: string,
  ) {
    super(message);
    this.name = 'CreateConferenceRoomError';
  }
}

/**
 * Create a room owned by the signed-in user and return its id.
 *
 * @throws CreateConferenceRoomError — `not-authenticated` when no token can be
 * obtained or the API answers 401, `failed` for anything else.
 */
export async function createConferenceRoom(): Promise<string> {
  let token: string;
  try {
    token = await getConferenceToken();
  } catch (err) {
    throw new CreateConferenceRoomError('not-authenticated', String(err));
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/conference`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({}),
    });
  } catch (err) {
    throw new CreateConferenceRoomError('failed', `network error: ${String(err)}`);
  }

  if (res.status === 401) {
    throw new CreateConferenceRoomError('not-authenticated', 'POST /conference answered 401');
  }
  if (!res.ok) {
    throw new CreateConferenceRoomError('failed', `POST /conference answered ${res.status}`);
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new CreateConferenceRoomError('failed', 'POST /conference returned invalid JSON');
  }
  const parsed = createConferenceResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new CreateConferenceRoomError('failed', 'POST /conference returned an unexpected shape');
  }
  return parsed.data.data.id;
}
