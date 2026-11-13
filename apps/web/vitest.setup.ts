/**
 * Every component spec renders through `act()`, and React only trusts `act()`
 * when this flag is set. Without it each call logs "The current testing
 * environment is not configured to support act(...)" — over five thousand lines
 * per run, all from passing specs. Set once here so a new spec cannot forget it.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach } from 'vitest';
import { resetActivePreferences } from '@/lib/preferences/active-preferences';

/**
 * Preferences are a module store (`lib/preferences/active-preferences.ts`), so one
 * spec's choices would otherwise reach the next spec in the same file — the job
 * `localStorage.clear()` did when each setting was its own key. Every spec starts
 * as a fresh signed-out visitor.
 */
afterEach(() => {
  resetActivePreferences('en');
});
