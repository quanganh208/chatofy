'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button, Dialog, DialogContent, DialogTitle } from '@chatofy/ui/react';
import { useReturnFocus } from '@/hooks/use-return-focus';
import { useTranslate } from '@/i18n/provider';
import { cn } from '@/lib/utils';
import { paneTabFor, type SettingsDialogView } from './settings-dialog-url';
import { SettingsTabContent } from './settings-dialog-tab-content';
import type { SettingsTabId } from './settings-tab-ids';
import { SETTINGS_TAB_GROUPS, settingsTab } from './settings-tabs';
import { settingsListBesidePane, useSettingsDialog } from './use-settings-dialog';

/**
 * All of Settings, as one large dialog over whatever page the reader is on.
 *
 * Mounted once by the signed-in frame (`layout/app-chrome.tsx`). Its state is the
 * address — `?settings=<tab>`, see `use-settings-dialog.ts` — so it opens from any
 * entry point, Back closes it, and the page underneath is never re-rendered for it.
 *
 * ## Two shapes from one tree
 *
 * From `sm`: a centred dialog, the grouped tab list in a column on the left and the
 * open tab's pane on the right, scrolling on its own. Below `sm` it fills the screen
 * and shows ONE of the two at a time, the way a phone's settings do: the list of tabs
 * (`?settings=menu`) with a chevron on each, or one tab with a back button to the
 * list. A wide screen shown the list token renders the first tab and rewrites the
 * address to it, so the URL always names what a wide screen shows.
 *
 * ## Surfaces and accent
 *
 * The dialog is the one elevated surface it draws. Its groups are hairline boxes
 * with no shadow (`settings-section.tsx`), and the active tab is a quiet `secondary`
 * ground, never `bg-primary`: the list says where you are, not what to do.
 *
 * ## Keyboard
 *
 * Arrow keys, Home and End move between tabs; Enter or Space opens one. On a phone,
 * opening a tab moves focus to its title, and going back returns it to that tab in
 * the list. Nested dialogs (photo, password, sign-out) layer above this one and give
 * focus back to the control that opened them.
 */
export function SettingsDialog() {
  const t = useTranslate();
  const dialog = useSettingsDialog();
  const titleId = useId();
  // Opened from the address, so there is no Trigger: focus goes back to the entry point.
  const returnFocus = useReturnFocus();

  // What was showing, kept through the closing animation: the address has already
  // lost `?settings=` by then, and the pane must not flash to another tab on its way out.
  const [shown, setShown] = useState<SettingsDialogView>(dialog.view);
  if (dialog.isOpen && dialog.view !== shown) setShown(dialog.view);
  const view = dialog.isOpen ? dialog.view : shown;
  const listing = view === null;
  const paneTab = paneTabFor(view);
  const meta = settingsTab(paneTab);

  const navRef = useRef<HTMLElement>(null);
  const paneTitleRef = useRef<HTMLHeadingElement>(null);
  const paneScrollRef = useRef<HTMLDivElement>(null);
  // Where focus goes once the next view has rendered: the pane's title after a phone
  // opened a tab, or the tab the reader came back from.
  const focusNext = useRef<{ to: 'pane' } | { to: 'tab'; tab: SettingsTabId } | null>(null);

  const { isOpen, show } = dialog;
  useEffect(() => {
    if (isOpen && view === null && settingsListBesidePane()) show(paneTab);
  }, [isOpen, view, paneTab, show]);

  useEffect(() => {
    paneScrollRef.current?.scrollTo?.({ top: 0 });
    const target = focusNext.current;
    focusNext.current = null;
    if (target?.to === 'pane') paneTitleRef.current?.focus();
    if (target?.to === 'tab') {
      navRef.current?.querySelector<HTMLElement>(`[data-settings-tab="${target.tab}"]`)?.focus();
    }
  }, [view]);

  const select = (tab: SettingsTabId) => {
    if (!settingsListBesidePane()) focusNext.current = { to: 'pane' };
    show(tab);
  };

  const backToList = () => {
    focusNext.current = { to: 'tab', tab: paneTab };
    show(null);
  };

  const onNavKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    const tabs = Array.from(
      navRef.current?.querySelectorAll<HTMLElement>('[data-settings-tab]') ?? [],
    );
    const at = tabs.indexOf(document.activeElement as HTMLElement);
    const next =
      event.key === 'ArrowDown'
        ? tabs[(at + 1) % tabs.length]
        : event.key === 'ArrowUp'
          ? tabs[(at - 1 + tabs.length) % tabs.length]
          : event.key === 'Home'
            ? tabs[0]
            : event.key === 'End'
              ? tabs.at(-1)
              : undefined;
    if (!next) return;
    event.preventDefault();
    next.focus();
  };

  return (
    <Dialog
      open={dialog.isOpen}
      onOpenChange={(next) => {
        if (!next) dialog.close();
      }}
    >
      <DialogContent
        closeLabel={t('web.chrome.close')}
        {...returnFocus}
        // The pane's title and description say what the open tab is for; the dialog's
        // own name is "Settings".
        aria-describedby={undefined}
        aria-labelledby={titleId}
        data-settings-dialog={view ?? 'menu'}
        className={cn(
          'flex gap-0 overflow-hidden p-0',
          // Clear of the window edge at 768px as everywhere else: the primitive's own
          // `calc(100%-2rem)` cap is replaced by this one from `sm`.
          'sm:h-[min(85vh,720px)] sm:max-w-[min(880px,calc(100%-2rem))]',
          // A phone: the whole screen, no frame.
          'max-sm:inset-0 max-sm:h-dvh max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none max-sm:border-0',
        )}
      >
        <div
          className={cn(
            'border-hairline flex min-h-0 flex-col sm:w-56 sm:shrink-0 sm:border-r',
            listing ? 'flex-1 sm:flex-none' : 'max-sm:hidden',
          )}
        >
          <div className="flex h-14 shrink-0 items-center px-5 sm:h-auto sm:px-4 sm:pt-5 sm:pb-3">
            <DialogTitle
              id={titleId}
              className="text-heading font-semibold tracking-tight sm:text-body"
            >
              {t('common.nav.settings')}
            </DialogTitle>
          </div>
          <nav
            ref={navRef}
            aria-label={t('web.settings.nav')}
            onKeyDown={onNavKeyDown}
            className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-3 pb-4 sm:px-2"
          >
            {SETTINGS_TAB_GROUPS.map((group) => (
              <div key={group.labelKey} className="flex flex-col gap-1">
                <span className="text-muted-foreground text-hint px-2.5 font-medium">
                  {t(group.labelKey)}
                </span>
                <ul className="flex flex-col gap-0.5">
                  {group.tabs.map((tab) => {
                    const current = view === tab.id;
                    return (
                      <li key={tab.id}>
                        <button
                          type="button"
                          data-settings-tab={tab.id}
                          aria-current={current ? 'page' : undefined}
                          onClick={() => select(tab.id)}
                          className={cn(
                            'text-body duration-fast ease-standard flex w-full items-center gap-3 rounded-md px-2.5 text-left transition-colors outline-none motion-reduce:transition-none',
                            'focus-visible:ring-ring/50 focus-visible:ring-[3px]',
                            // A phone's list is rows to tap; the column is a compact list.
                            'min-h-11 sm:min-h-0 sm:gap-2.5 sm:py-1.5 pointer-coarse:min-h-11',
                            current
                              ? 'bg-secondary text-foreground font-medium'
                              : 'text-foreground sm:text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
                          )}
                        >
                          <tab.icon aria-hidden className="size-4 shrink-0" />
                          <span className="min-w-0 flex-1 truncate">{t(tab.labelKey)}</span>
                          <ChevronRight
                            aria-hidden
                            className="text-muted-foreground size-4 shrink-0 sm:hidden"
                          />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        <section
          key={paneTab}
          aria-labelledby={`${titleId}-pane`}
          data-settings-pane={paneTab}
          className={cn(
            'flex min-h-0 min-w-0 flex-1 flex-col',
            listing
              ? 'max-sm:hidden'
              : 'max-sm:animate-in max-sm:slide-in-from-right-8 max-sm:fade-in max-sm:duration-200 motion-reduce:animate-none',
          )}
        >
          {/* A phone's way back to the list. The ✕ in the corner closes everything. */}
          <div className="flex h-14 shrink-0 items-center px-2 sm:hidden">
            <Button
              variant="ghost"
              onClick={backToList}
              aria-label={t('web.settings.backToList')}
              data-settings-back
              className="text-foreground px-2"
            >
              <ChevronLeft aria-hidden />
              {t('common.nav.settings')}
            </Button>
          </div>
          <div ref={paneScrollRef} className="min-h-0 flex-1 overflow-y-auto">
            <div className="flex flex-col gap-8 px-5 pt-2 pb-8 sm:px-8 sm:pt-7">
              {/* Right padding on a wide screen clears the ✕ in the corner. */}
              <header className="flex flex-col gap-1 sm:pr-8">
                <h2
                  ref={paneTitleRef}
                  id={`${titleId}-pane`}
                  tabIndex={-1}
                  className="text-heading font-semibold tracking-tight outline-none"
                >
                  {t(meta.labelKey)}
                </h2>
                <p className="text-muted-foreground text-body max-w-[62ch]">
                  {t(meta.descriptionKey)}
                </p>
              </header>
              <SettingsTabContent tab={paneTab} />
            </div>
          </div>
        </section>
      </DialogContent>
    </Dialog>
  );
}
