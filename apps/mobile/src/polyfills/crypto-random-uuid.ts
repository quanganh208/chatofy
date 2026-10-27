/**
 * `crypto.randomUUID` for Hermes, which has no Web Crypto.
 *
 * The shared translate client names every turn it opens with
 * `crypto.randomUUID()` (`newTurnId` beside `TranslateSocket`); without this
 * that call throws on Hermes and the speaker leg cannot open a single turn. The
 * room's own `turnId` is the server's session id, so nothing here reaches it.
 * Imported first by the root layout so it is in place before anything from
 * `@chatofy/realtime-client` runs.
 *
 * Guarded: a runtime that already has either is left alone. Math.random is
 * enough here — the id names a turn, it protects nothing — and avoids a native
 * module, which would force a prebuild and a fresh install on every device.
 */

/** UUID v4 from Math.random: version nibble 4, variant bits 10xx. */
export function randomUuidV4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const scope = globalThis as unknown as { crypto?: { randomUUID?: () => string } };
scope.crypto ??= {};
scope.crypto.randomUUID ??= randomUuidV4;
