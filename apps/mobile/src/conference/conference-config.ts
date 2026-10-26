/**
 * Endpoints the conference feature talks to, derived from the app's one API base
 * URL so the REST lobby, the signaling socket and the translate socket can never
 * point at different servers.
 */

import { API_BASE_URL } from '../config/api-base-url';

export { API_BASE_URL };

const WS_BASE_URL = API_BASE_URL.replace(/^http/, 'ws');

/** SFU signaling + room events. */
export const CONFERENCE_WS_URL = `${WS_BASE_URL}/ws/conference`;

/** Live translation of this client's own mic; a second socket opened on join. */
export const TRANSLATE_WS_URL = `${WS_BASE_URL}/ws/translate`;
