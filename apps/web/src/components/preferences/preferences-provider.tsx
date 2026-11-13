'use client';

import { useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import type { PreferencesTransport } from '@chatofy/api-client';
import { getPreferences, resetPreferences, updatePreferences } from '@/clients/api-client';
import { useConversationRunning } from '@/hooks/use-conversation-running';
import { usePreferences, usePreferencesHold } from '@/hooks/use-preferences';
import { useLocale } from '@/i18n/provider';
import {
  activePreferences,
  resetActivePreferences,
  setActivePreferences,
} from '@/lib/preferences/active-preferences';
import { cachedUserId, forgetAccountPreferences } from '@/lib/preferences/preferences-cache';
import { createAccountHolder, type AccountHolder } from '@/lib/preferences/preferences-holders';
import { isLiveSession } from '@/lib/session-guard';
import { applyChoice } from '@/lib/theme';

const TRANSPORT: PreferencesTransport = {
  load: getPreferences,
  save: updatePreferences,
  reset: resetPreferences,
};

/**
 * Opens the account's preferences when the session names one, and keeps them in
 * step with the rest of the browser and the account's other devices.
 *
 * Mounted once, in the root layout, inside the session provider: every page draws
 * on the theme, including the signed-out ones, and a signed-in reader on the
 * landing page is still the account whose theme it should be.
 *
 * ## When the session is still loading
 *
 * A returning reader's cache already names their account. The store is opened from
 * it at once — the page renders their own setup instead of waiting on the session
 * fetch — but sends nothing until the session confirms it is the same account
 * (`AccountHolder.confirm`). A different account, or none, drops it.
 *
 * ## Staying in step
 *
 * - Other tabs of this browser: a BroadcastChannel inside the holder.
 * - Other devices: re-read on focus and when the tab becomes visible. There is no
 *   push; a change made on the phone shows up the next time this tab is looked at.
 * - Unsaved changes: sent when the browser comes back online and when the page
 *   goes away.
 * - Never mid-session: held while a conversation runs on this tab (and while a
 *   meeting call does — the room page holds its own, see `usePreferencesHold`).
 */
export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const { data, status } = useSession();
  const locale = useLocale();
  const userId =
    status === 'authenticated' && isLiveSession(data) ? (data?.user?.id ?? null) : null;
  const account = useRef<AccountHolder | null>(null);

  useEffect(() => {
    const open = (id: string) => {
      const holder = createAccountHolder({ userId: id, locale, transport: TRANSPORT });
      account.current?.dispose(false);
      account.current = holder;
      setActivePreferences(holder);
      return holder;
    };

    if (status === 'loading') {
      const cached = cachedUserId();
      if (cached && account.current?.userId !== cached) open(cached);
      else if (!account.current) resetActivePreferences(locale, true);
      return;
    }
    if (userId) {
      const holder = account.current?.userId === userId ? account.current : open(userId);
      holder.confirm();
      return;
    }
    // Signed out, or a session that can no longer be renewed: no account to sync.
    account.current?.dispose(true);
    account.current = null;
    forgetAccountPreferences();
    resetActivePreferences(locale);
  }, [status, userId, locale]);

  useEffect(
    () => () => {
      account.current?.dispose(false);
      account.current = null;
    },
    [],
  );

  useEffect(() => {
    const refresh = () => activePreferences().refresh();
    const flush = () => activePreferences().flush();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh();
      // A backgrounded tab on a phone may be killed without ever firing `pagehide`.
      else flush();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', flush);
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', flush);
      window.removeEventListener('pagehide', flush);
    };
  }, []);

  usePreferencesHold(useConversationRunning());

  // The pre-paint script painted the cached theme; from here the store's answer is
  // the one on the document, including a theme changed on another device.
  const { ready, preferences } = usePreferences();
  useEffect(() => {
    if (ready) applyChoice(preferences.theme);
  }, [ready, preferences.theme]);

  return children;
}
