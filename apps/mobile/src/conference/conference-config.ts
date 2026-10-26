/**
 * Endpoints the conference feature talks to, derived from one base URL so the
 * REST lobby, the signaling socket, the translate socket and the dev sign-in can
 * never point at different servers.
 *
 * `EXPO_PUBLIC_API_BASE_URL` is read with bracket access, which Expo exposes at
 * runtime in development builds; the conference feature is development-only, and
 * the fallback is the Android emulator's alias for the host machine.
 */

export const API_BASE_URL = process.env['EXPO_PUBLIC_API_BASE_URL'] ?? 'http://10.0.2.2:3000';

const WS_BASE_URL = API_BASE_URL.replace(/^http/, 'ws');

/** SFU signaling + room events. */
export const CONFERENCE_WS_URL = `${WS_BASE_URL}/ws/conference`;

/** Live translation of this client's own mic; a second socket opened on join. */
export const TRANSLATE_WS_URL = `${WS_BASE_URL}/ws/translate`;
