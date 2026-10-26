/**
 * The app's one AuthClient instance. The provider renders from it and the
 * conference feature reads its bearer token from it, so both see the same
 * session and share one in-flight refresh.
 */

import { API_BASE_URL } from '@/config/api-base-url';
import { HttpAuthClient } from './http-auth-client';
import { secureSessionStore } from './secure-session-store';

export const authClient = new HttpAuthClient({ baseUrl: API_BASE_URL, store: secureSessionStore });
