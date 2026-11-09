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
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  useSidebar,
} from '@chatofy/ui/react';
import { useTranslate } from '@/i18n/provider';
import { Brand } from './brand';
import { navGroups, navItemFor } from './nav-items';
import { SessionMenu } from './session-menu';

/**
 * The product navigation.
 *
 * ## No group label — reopened with two groups, and still no
 *
 * `SidebarGroupLabel` is not rendered. The question was left open until there were two
 * groups to tell apart; there are now, and the answer did not change. Two captions
 * would sit above four items whose icons and labels already say what they are, and the
 * rail hides captions while keeping the separator — so the separator is what actually
 * carries the grouping in both states. The mockup draws it the same way. See
 * `nav-items.ts` for what the two groups mean.
 *
 * ## The rail's accessible names do not come from the tooltip
 *
 * Collapsed, each item is an icon. `SidebarMenuButton`'s `tooltip` prop supplies the
 * visible affordance on hover — and a tooltip is not an accessible name: it is absent
 * from the accessibility tree until it opens, and it never opens for a screen reader.
 * The label is on the link itself, so the name is the same whether the sidebar is open,
 * collapsed, or being read aloud.
 */
interface SidebarResize {
  width: number;
  ready: boolean;
  setWidth: (width: number) => void;
  reset: () => void;
}

export function AppSidebar({ resize }: { resize: SidebarResize }) {
  const active = navItemFor(usePathname());
  const t = useTranslate();
  const { state, isMobile } = useSidebar();
  // Only an open sidebar on a desktop can be resized: the rail is a fixed icon column and
  // on a phone the sidebar is a sheet.
  const resizable = resize.ready && state === 'expanded' && !isMobile;

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        {/* `px-2` matches the menu buttons below, so the mark and the nav share one
            left edge in both states rather than stepping in and out.

            The wordmark is dropped on the rail. Nothing in `SidebarHeader` clips its
            children, so a 60px rail was rendering "Chatofy" straight out past its own
            edge and over the page. The lotus mark stays — it is icon-sized and lines
            up with the icons below, which is what the rail is. The child selector
            matches `SidebarMenuButton`'s own `[&>span:last-child]` idiom rather than
            adding a prop to `Brand` for one caller. */}
        <Brand
          size={20}
          className="group-data-[collapsible=icon]:[&>span:last-child]:hidden px-2 py-2"
        />
      </SidebarHeader>

      <SidebarContent>
        {navGroups().map((group, index) => (
          <SidebarGroup key={group[0]?.href ?? index} className="py-0">
            {/* Between groups only, never above the first — a rule that reads better as
                the separator belonging to the group below it than as an index test at
                the bottom of the list. */}
            {index > 0 ? <SidebarSeparator className="mb-2" /> : null}
            <SidebarGroupContent>
              <SidebarMenu>
                {group.map((item) => {
                  const label = t(item.labelKey);
                  return (
                    <SidebarMenuItem key={item.href}>
                      {/* The page you are on, in the brand's dawn. Decoration only: the
                          the link itself carries `aria-current`. */}
                      {active === item ? (
                        <span
                          aria-hidden
                          data-slot="sidebar-active-bar"
                          className="absolute inset-y-1.5 -left-2 z-10 w-1 rounded-full"
                          style={{
                            backgroundImage: `linear-gradient(180deg, ${dawn.peach}, ${dawn.lavender}, ${dawn.mint})`,
                          }}
                        />
                      ) : null}
                      <SidebarMenuButton asChild isActive={active === item} tooltip={label}>
                        <Link
                          href={item.href}
                          aria-label={label}
                          aria-current={active === item ? 'page' : undefined}
                        >
                          <item.icon aria-hidden />
                          <span>{label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <SessionMenu />
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
