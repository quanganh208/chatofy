/**
 * Which ground the popup renders on, and where that answer is kept.
 *
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
const KEY = 'chatofy.theme';

/** What the reader chose. `system` is stored as the absence of a value. */
export type ThemeChoice = 'light' | 'dark' | 'system';

export async function loadTheme(): Promise<ThemeChoice> {
  const stored = await chrome.storage.local.get(KEY);
  const value = stored[KEY];
  return value === 'light' || value === 'dark' ? value : 'system';
}

export async function saveTheme(choice: ThemeChoice): Promise<void> {
  // Removed rather than written as the word "system": one representation of "no
  // choice" means there is no second one to forget to handle, and the CSS already
  // treats the absence of a class as the machine's decision.
  if (choice === 'system') await chrome.storage.local.remove(KEY);
  else await chrome.storage.local.set({ [KEY]: choice });
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
