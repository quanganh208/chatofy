'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
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
} from '@chatofy/ui/react';
import { useTranslate } from '@/i18n/provider';
import { Brand } from './brand';
import { NAV_GROUPS } from './nav-items';
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
export function AppSidebar() {
  const pathname = usePathname();
  const t = useTranslate();

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
        {NAV_GROUPS.map((group, index) => (
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
                      <SidebarMenuButton asChild isActive={pathname === item.href} tooltip={label}>
                        <Link href={item.href} aria-label={label}>
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
    </Sidebar>
  );
}
