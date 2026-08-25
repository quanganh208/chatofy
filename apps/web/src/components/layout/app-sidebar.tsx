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
} from '@chatofy/ui/react';
import { useTranslate } from '@/i18n/provider';
import { Brand } from './brand';
import { NAV_ITEMS } from './nav-items';
import { SessionMenu } from './session-menu';

/**
 * The product navigation.
 *
 * ## No group label
 *
 * `SidebarGroupLabel` is not rendered, and that is a decision rather than an omission.
 * A caption names a group so it can be told from another group; with one list and one
 * separator there is nothing to tell apart, and a heading over a single list is a word
 * the reader has to skip. The mockup draws it the same way — a separator, no caption.
 * When Preferences and Account arrive under that separator the question is worth
 * reopening, and it will be a real question then.
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
            left edge in both states rather than stepping in and out. */}
        <Brand className="px-2 py-2" />
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map((item) => {
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
      </SidebarContent>

      <SidebarFooter>
        <SessionMenu />
      </SidebarFooter>
    </Sidebar>
  );
}
