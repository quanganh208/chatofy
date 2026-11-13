/**
 * Which ground the reader has asked for, and how it reaches the document.
 *
 * The choice itself is an account preference now (`theme` in the preferences
 * document), read through `useThemeChoice`. What stays here is the part that runs
 * outside React: putting the choice on `<html>`, and the blocking script that does
 * so before the first paint from the local copy of the preferences.
 */
import type { ThemeChoice } from '@chatofy/types';
import { PREFERENCES_CACHE_KEY } from '@/lib/preferences/preferences-cache';

export type { ThemeChoice };

/**
 * Runs in `<head>` before anything paints, which is the whole point. Without it,
 * someone who chose light on a dark machine sees a dark flash on every load — the
 * markup arrives with no class, `color-scheme: light dark` resolves to the
 * machine's answer, and the correction only lands once React has hydrated.
 *
 * It reads the theme out of the cached preferences, whoever they belong to: it
 * runs before the session is known, and the cache is the last reader of this
 * browser — a returning reader in almost every case, and a wrong guess is
 * corrected by the provider the moment the session answers.
 *
 * Kept to one statement and wrapped in try/catch: it runs before any error
 * handling exists, and a throw here (no cache, unparseable JSON, storage refused)
 * would leave the page unstyled rather than merely following the machine.
 */
export const PRE_PAINT_THEME_SCRIPT = `try{var t=JSON.parse(localStorage.getItem(${JSON.stringify(PREFERENCES_CACHE_KEY)})).preferences.theme;if(t==="light"||t==="dark")document.documentElement.classList.add(t)}catch(e){}`;

/**
 * Put the choice on the document.
 *
 * Both classes are removed first and then at most one is added: leaving `light` in
 * place while adding `dark` gives a document that matches neither rule cleanly, and
 * which one wins becomes a question about source order in `globals.css`.
 *
 * Under `system` neither class is present, which is what lets
 * `color-scheme: light dark` on `:root` hand the decision back to the browser —
 * including when the OS theme changes while the page is open.
 */
export function applyChoice(choice: ThemeChoice): void {
  const root = document.documentElement;
  root.classList.remove('light', 'dark');
  if (choice !== 'system') root.classList.add(choice);
}
