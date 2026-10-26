/**
 * The one API origin every mobile feature talks to: sign-in, the conference REST
 * lobby and both sockets. Derived from one variable so they can never point at
 * different servers.
 *
 * `EXPO_PUBLIC_API_BASE_URL` is inlined by Expo at bundle time; the fallback is the
 * Android emulator's alias for the host machine.
 */
export const API_BASE_URL = process.env['EXPO_PUBLIC_API_BASE_URL'] ?? 'http://10.0.2.2:3000';
