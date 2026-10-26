/**
 * The device's SessionStore: the session as one JSON value in the OS keystore
 * (Android Keystore / iOS Keychain) via `expo-secure-store`.
 *
 * Secure storage rather than AsyncStorage because the refresh token IS the
 * credential: thirty days of access, and a replay of it revokes the whole family.
 */

import * as SecureStore from 'expo-secure-store';
import { authSessionSchema } from '@chatofy/types/http';
import type { AuthSession } from './auth-client.interface';
import type { SessionStore } from './http-auth-client';

const KEY = 'chatofy.auth.session';

export const secureSessionStore: SessionStore = {
  async load() {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return null;
    // A value written by an older build that no longer parses is a signed-out device.
    const parsed = authSessionSchema.safeParse(JSON.parse(raw));
    return parsed.success ? (parsed.data as AuthSession) : null;
  },
  async save(session) {
    await SecureStore.setItemAsync(KEY, JSON.stringify(session));
  },
  async clear() {
    await SecureStore.deleteItemAsync(KEY);
  },
};
