'use client';

import { usePathname } from 'next/navigation';
import { SidebarTrigger } from '@chatofy/ui/react';
import { useTranslate } from '@/i18n/provider';
import { NAV_ITEMS } from './nav-items';
import { ConnectedThemeToggle } from './theme-toggle-connected';

/**
 * Where you are, and the two controls that belong to every product route.
 *
 * The title is read from `NAV_ITEMS`, not passed down from the page — a layout
 * receives nothing from the page below it, and the alternative was a second list of
 * route names maintained by hand. A route with no nav item renders no title rather
 * than a guess made from the URL.
 *
 * **Surface state does not live here.** The next phase gives `/translate` a live status
 * — listening, translating, speaking — and that belongs beside this title, replacing it.
 * What must not happen is the rest of the translate surface following it up here because
 * there is now room: the mic level, the transcript controls and the direction readout
 * stay inside `CascadePanel`, which owns them. Chrome holds what is true on every route.
 */
export function AppTopbar() {
  const pathname = usePathname();
  const t = useTranslate();
  const current = NAV_ITEMS.find((item) => item.href === pathname);

  return (
    <div className="border-hairline bg-background flex h-14 items-center gap-3 border-b px-4">
      {/* `aria-label` rather than the primitive's own `sr-only` span, which is the one
          string in this chrome the CLI hard-codes in English. Overriding the name here
          keeps the generated component unforked and still leaves nothing untranslated. */}
      <SidebarTrigger aria-label={t('web.chrome.toggleSidebar')} />
      {current ? (
        <h1 className="text-body font-semibold tracking-tight">{t(current.labelKey)}</h1>
      ) : null}
      <div className="ml-auto flex items-center gap-2">
        <ConnectedThemeToggle />
      </div>
    </div>
  );
}
