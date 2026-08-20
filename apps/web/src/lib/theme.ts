/**
 * Which ground the reader has asked for, and where that answer is kept.
 *
 * Three states, but only two are stored. "Follow the machine" is the *absence* of a
 * choice rather than a third value — storing the word would mean remembering to
 * treat it as equivalent to nothing, and forgetting once produces a setting that
 * looks selected and stops responding when the OS theme changes.
 *
 * The names here are duplicated, deliberately and exactly once, inside the blocking
 * script in `app/layout.tsx`. That script runs before any module loads and cannot
 * import this file; `theme.spec.ts` compares the two so they cannot drift.
 */
export const THEME_STORAGE_KEY = 'chatofy.theme';

/** What the reader chose. `system` means nothing is stored. */
export type ThemeChoice = 'light' | 'dark' | 'system';

/** What is actually on screen. `system` resolves to one of these. */
export type ResolvedTheme = 'light' | 'dark';

export function readChoice(): ThemeChoice {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    // Private mode, or storage disabled by policy. Following the machine is the
    // right answer when we cannot remember anything.
    return 'system';
  }
}

export function writeChoice(choice: ThemeChoice): void {
  try {
    if (choice === 'system') localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // The class below is still applied, so the choice holds for this page even when
    // it cannot outlive it.
  }
}

export function systemTheme(): ResolvedTheme {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

export function resolve(choice: ThemeChoice): ResolvedTheme {
  return choice === 'system' ? systemTheme() : choice;
}

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
