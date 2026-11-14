/**
 * Which preferences this tab is holding, readable from anywhere.
 *
 * A module store rather than a React context, for the reason
 * `use-conversation-running.ts` gives: the Settings dialog, the translate page and
 * the meeting room sit in different subtrees, and two non-React readers — the
 * meeting's speaker leg and its call attempt, built when "Join" is pressed — need
 * the same answer synchronously. `PreferencesProvider` decides which holder is
 * active (an account's once the session names one, a visitor's otherwise); every
 * hook reads through here.
 *
 * Until a provider activates one, a visitor holder answers — a theme-only, local
 * state — so a component rendered on its own (a spec, a story) still works.
 */
import { localeFromHtmlLang } from '@chatofy/i18n';
import type { UserPreferences } from '@chatofy/types';
import {
  createVisitorHolder,
  type PreferencesHolder,
  type PreferencesSnapshot,
} from './preferences-holders';

let active: PreferencesHolder | null = null;
let unsubscribeActive: (() => void) | null = null;
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) listener();
};

export function activePreferences(): PreferencesHolder {
  if (!active) setActivePreferences(createVisitorHolder(defaultLocale()));
  return active!;
}

/** Make `holder` the tab's preferences. The previous one is NOT disposed here. */
export function setActivePreferences(holder: PreferencesHolder): void {
  if (holder === active) return;
  unsubscribeActive?.();
  active = holder;
  unsubscribeActive = holder.subscribe(emit);
  emit();
}

/**
 * Drop whatever is active and start again as a fresh visitor. What a provider does
 * when the account goes away, and what the test setup does between specs so one
 * spec's choices never reach the next.
 */
export function resetActivePreferences(locale = defaultLocale(), pending = false): void {
  const previous = active;
  setActivePreferences(createVisitorHolder(locale, pending));
  previous?.dispose(false);
}

export function subscribeActivePreferences(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function activePreferencesSnapshot(): PreferencesSnapshot {
  return activePreferences().getSnapshot();
}

/**
 * The document as of now, for code outside React. The meeting's speaker leg reads
 * its voices here when it is built, which is after "Join" — so a change made a
 * moment before is already in it (updates apply to the snapshot synchronously).
 */
export function currentPreferences(): UserPreferences {
  return activePreferencesSnapshot().preferences;
}

/** The page's locale, read back through `htmlLang`'s tag (`zh-CN` is the `zh` locale). */
function defaultLocale(): string {
  return (
    (typeof document === 'undefined'
      ? undefined
      : localeFromHtmlLang(document.documentElement.lang)) ?? 'en'
  );
}
