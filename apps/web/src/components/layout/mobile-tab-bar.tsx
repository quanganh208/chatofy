'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { usePathname } from 'next/navigation';
import { History, Mic, Video, type LucideIcon } from 'lucide-react';
import type { MessageKey } from '@chatofy/i18n';
import { useTranslate } from '@/i18n/provider';
import { rememberTranslateMode, useLastTranslateMode } from './last-translate-mode';
import { MoreSheet } from './more-sheet';
import { isSettingsPath, navItemFor } from './nav-items';
import { TAB_CLASS } from './tab-bar-styles';

/**
 * The navigation below 768px: four tabs fixed to the bottom of the screen.
 *
 * It replaces the sidebar there — the sidebar's sheet is still in the tree, but its
 * trigger is hidden below `md`, because a hamburger at the top of a phone is the
 * furthest reach on the screen and a tab bar is the nearest.
 *
 * The frame decides whether it is drawn at all (not in a conference room, not while a
 * screen asks for immersion — see `app-chrome.tsx`) and pads the content by its height,
 * so nothing scrolls under it. Its own bottom padding is the safe-area inset, so the
 * tabs clear the home indicator on a notched phone.
 */
interface Tab {
  key: string;
  href: Route;
  labelKey: MessageKey;
  icon: LucideIcon;
  active: (pathname: string) => boolean;
}

export function MobileTabBar() {
  const t = useTranslate();
  const pathname = usePathname();
  const translateHref = useLastTranslateMode();

  // Mounted on every signed-in route, so it is the one place that sees each visit.
  useEffect(() => {
    rememberTranslateMode(pathname);
  }, [pathname]);

  const tabs: Tab[] = [
    {
      key: 'translate',
      href: translateHref,
      labelKey: 'web.chrome.tabTranslate',
      icon: Mic,
      active: (path) => path.startsWith('/translate/'),
    },
    {
      key: 'meetings',
      href: '/conference',
      labelKey: 'web.chrome.tabMeetings',
      icon: Video,
      active: (path) => navItemFor(path)?.href === '/conference',
    },
    {
      key: 'history',
      href: '/history',
      labelKey: 'web.chrome.tabHistory',
      icon: History,
      active: (path) => navItemFor(path)?.href === '/history',
    },
  ];

  return (
    <nav
      aria-label={t('web.chrome.tabBar')}
      data-slot="mobile-tab-bar"
      className="border-hairline bg-background fixed inset-x-0 bottom-0 z-40 border-t pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="grid grid-cols-4">
        {tabs.map((tab) => {
          const current = tab.active(pathname);
          return (
            <li key={tab.key}>
              <Link
                href={tab.href}
                className={TAB_CLASS}
                aria-current={current ? 'page' : undefined}
              >
                <tab.icon aria-hidden />
                <span>{t(tab.labelKey)}</span>
              </Link>
            </li>
          );
        })}
        <li>
          <MoreSheet
            active={navItemFor(pathname)?.href === '/glossary' || isSettingsPath(pathname)}
          />
        </li>
      </ul>
    </nav>
  );
}
