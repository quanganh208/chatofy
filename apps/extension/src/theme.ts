import { readCachedPreferences } from './preferences-cache';

/**
 * Which ground the popup renders on.
 *
 * The choice belongs to the account (`theme` in its preferences) and this module
 * only reads it back from the cache, which is what lets the popup paint the right
 * ground before the network answers. Writes go through the preferences store.
 * Deliberately NOT part of `CaptureSettings`. That object is what the worker hands
 * the offscreen document when a capture starts, and a change to it is a change the
 * worker has to process — so folding an appearance preference in would make choosing
 * a theme mid-call a settings write that a running capture reacts to. The recording
 * notice flag sits outside that object for the same reason, and this follows it.
 *
 * The overlay has no equivalent and must not gain one: inside a content script
 * `prefers-color-scheme` answers for the operating system rather than for the meeting
 * page, so following a preference there would put a light panel over a dark call.
 */
/** The key older builds kept the choice under, before the account held it. */
const LEGACY_KEY = 'chatofy.theme';

/** What the reader chose. `system` follows the machine. */
export type ThemeChoice = 'light' | 'dark' | 'system';

/** The cached account's choice; `system` while signed out or never synced. */
export async function loadTheme(): Promise<ThemeChoice> {
  return (await readCachedPreferences())?.theme ?? 'system';
}

/** Forget the per-browser value: the account's choice replaces it, unimported. */
export async function dropLegacyTheme(): Promise<void> {
  await chrome.storage.local.remove(LEGACY_KEY);
}

/**
 * Put the choice on the document.
 *
 * Both classes come off before one goes on. Leaving `light` in place while adding
 * `dark` produces a document matching neither cleanly, and which wins becomes a
 * question about the order rules happen to appear in.
 */
export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  root.classList.remove('light', 'dark');
  if (choice !== 'system') root.classList.add(choice);
}
