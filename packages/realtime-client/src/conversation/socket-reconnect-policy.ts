/**
 * When a /translate conversation tries its socket again after a drop, and how
 * long it waits for an answer before deciding the socket is dead.
 *
 * Why it exists: on 2026-11-11 a browser's socket died between the browser and
 * the Cloudflare edge mid-conversation. The client ended the conversation on
 * the spot, and the turn the server was translating at that moment was lost.
 * Reconnecting keeps the conversation going; this module holds only the
 * numbers, so the schedule can be tested without a socket.
 */

/**
 * The wait before each attempt, in order. Three attempts over about 6 s:
 * long enough for a Wi-Fi roam or an edge reset to clear, and short enough
 * that the held audio (the pipeline's ceiling is 20 s) is still worth sending.
 */
export const RECONNECT_DELAYS_MS = [500, 1500, 4000] as const;

/**
 * How long a turn that finished capture may go without any server frame
 * before the socket is treated as dead.
 *
 * On prod on 2026-11-11 a final took up to 3.3 s and the first TTS audio up to
 * 4.6 s, so anything much shorter would trip on a turn that was slow but
 * healthy. It is armed only while a turn awaits its answer: while someone is
 * only listening, server silence is normal.
 */
export const AWAITING_ANSWER_WATCHDOG_MS = 15_000;

/**
 * How long one reconnect attempt's handshake may take before it counts as
 * failed. Without it, a handshake on the path that just went half-open can
 * stall until the browser gives up, holding the conversation in
 * `reconnecting` far past the schedule above.
 */
export const RECONNECT_ATTEMPT_TIMEOUT_MS = 5_000;

/**
 * The wait before attempt `attempt` (1-based), jittered by ±20% so clients
 * dropped together do not reconnect together. `null` once the schedule is
 * exhausted.
 */
export function reconnectDelay(attempt: number, random: () => number = Math.random): number | null {
  const base = RECONNECT_DELAYS_MS[attempt - 1];
  if (base === undefined) return null;
  return Math.round(base * (0.8 + 0.4 * random()));
}
