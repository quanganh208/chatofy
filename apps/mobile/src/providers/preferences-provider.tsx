import { useEffect, type ReactNode } from 'react';
import { AppState } from 'react-native';
import {
  bindAccountPreferences,
  flushAccountPreferences,
  refreshAccountPreferences,
  unbindAccountPreferences,
} from '@/preferences/account-preferences';
import { useAuth } from './auth-provider';

/**
 * Keeps the account's preferences synced for whoever is signed in: loads them at
 * sign-in, drops them (and the cached copy) at sign-out, reads the server copy
 * when the app comes to the foreground and sends pending changes when it leaves.
 * There is no connectivity listener; coming back to the app is the retry point
 * after being offline, on top of the store's own backoff.
 */
export function PreferencesProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const locale = session?.user.locale ?? null;

  useEffect(() => {
    if (userId === null) return;
    bindAccountPreferences(userId, locale);
    return () => {
      void unbindAccountPreferences(true);
    };
    // The locale only seeds defaults at bind time; it must not rebind on its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshAccountPreferences();
      else flushAccountPreferences();
    });
    return () => subscription.remove();
  }, []);

  return children;
}
