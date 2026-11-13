'use client';

import { dawn } from '@chatofy/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ResizeHandle,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@chatofy/ui/react';
import { useTranslate } from '@/i18n/provider';
import { Brand } from './brand';
import { CreditLine } from './credit-line';
import { openSettingsDialog } from '@/components/settings/use-settings-dialog';
import { navGroups, navItemFor, SETTINGS_ENTRY, type NavItem } from './nav-items';
import { SessionMenu } from './session-menu';

/**
 * The product navigation: two captioned groups, and a footer holding Settings and
 * who you are.
 *
 * ## Captions now, and why the rail still reads
 *
 * `SidebarGroupLabel` is rendered — see `nav-items.ts` for why the groups earned
 * captions. Collapsed to the rail the primitive hides them, and the icons alone carry
 * the list there, as they always did.
 *
 * ## The rail's accessible names do not come from the tooltip
 *
 * Collapsed, each item is an icon. `SidebarMenuButton`'s `tooltip` prop supplies the
 * visible affordance on hover — and a tooltip is not an accessible name: it is absent
 * from the accessibility tree until it opens, and it never opens for a screen reader.
 * The label is on the link itself, so the name is the same whether the sidebar is open,
 * collapsed, or being read aloud.
 *
 * ## Settings is a button, not a link
 *
 * It opens the Settings dialog over the current page (`?settings=`, see
 * `settings/use-settings-dialog.ts`) rather than leaving it, so it never carries
 * `aria-current` or the dawn bar: the page you are on is still the one underneath.
 */
interface SidebarResize {
  width: number;
  ready: boolean;
  setWidth: (width: number) => void;
  reset: () => void;
}

export function AppSidebar({ resize }: { resize: SidebarResize }) {
  const pathname = usePathname();
  const active = navItemFor(pathname);
  const t = useTranslate();
  const { state, isMobile } = useSidebar();
  // Only an open sidebar on a desktop can be resized: the rail is a fixed icon column and
  // on a phone the sidebar is a sheet.
  const resizable = resize.ready && state === 'expanded' && !isMobile;

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        {/* `px-2` matches the menu buttons below, so the mark and the nav share one
            left edge in both states. The wordmark is dropped on the rail, where it
            would render straight out past the 60px column; the lotus stays. */}
        <Brand
          size={20}
          className="group-data-[collapsible=icon]:[&>span:last-child]:hidden px-2 py-2"
        />
      </SidebarHeader>

      <SidebarContent>
        {navGroups().map((group) => (
          <SidebarGroup key={group.labelKey}>
            {/* Muted ink rather than the primitive's 70% foreground, which composites
                below the contrast floor the muted token is measured to. */}
            <SidebarGroupLabel className="text-muted-foreground">
              {t(group.labelKey)}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <NavLink key={item.href} item={item} active={active === item} />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SettingsEntry />
          <SessionMenu detail={<CreditLine />} />
        </SidebarMenu>
      </SidebarFooter>

      {resizable ? (
        <ResizeHandle
          label={t('web.chrome.sidebarWidth')}
          value={resize.width}
          min={200}
          max={360}
          grow="right"
          onChange={resize.setWidth}
          onReset={resize.reset}
          // The primitive eases its width over 200ms for the collapse animation; while a
          // pointer is down that would make the panel trail it.
          onDragStart={() => document.documentElement.classList.add('sidebar-resizing')}
          onDragEnd={() => document.documentElement.classList.remove('sidebar-resizing')}
          className="-right-1.5"
        />
      ) : null}
    </Sidebar>
  );
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const t = useTranslate();
  const label = t(item.labelKey);
  return (
    <SidebarMenuItem>
      {/* The page you are on, in the brand's dawn. Decoration only: the link itself
          carries `aria-current`. */}
      {active ? (
        <span
          aria-hidden
          data-slot="sidebar-active-bar"
          className="absolute inset-y-1.5 -left-1 z-10 w-1 rounded-full"
          style={{
            backgroundImage: `linear-gradient(180deg, ${dawn.peach}, ${dawn.lavender}, ${dawn.mint})`,
          }}
        />
      ) : null}
      <SidebarMenuButton asChild isActive={active} tooltip={label}>
        <Link href={item.href} aria-label={label} aria-current={active ? 'page' : undefined}>
          <item.icon aria-hidden />
          <span>{label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

/** The footer's Settings entry: opens the dialog over the current page. */
function SettingsEntry() {
  const t = useTranslate();
  const label = t(SETTINGS_ENTRY.labelKey);
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        tooltip={label}
        aria-label={label}
        aria-haspopup="dialog"
        data-settings-entry
        onClick={() => openSettingsDialog()}
      >
        <SETTINGS_ENTRY.icon aria-hidden />
        <span>{label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
