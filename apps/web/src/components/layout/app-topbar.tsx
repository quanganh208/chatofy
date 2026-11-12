'use client';

import { Fragment } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
  SidebarTrigger,
} from '@chatofy/ui/react';
import { useTranslate } from '@/i18n/provider';
import { useChromeSlots } from './chrome-slots';
import { navPlaceFor } from './nav-items';

/**
 * Where you are, and what this screen lets you do: a breadcrumb on the left, the
 * page's own actions on the right.
 *
 * **The last crumb is the page's `<h1>`.** App screens no longer open with a display
 * title of their own, so the one heading a screen reader jumps to is here, and it is
 * the same words the sidebar highlights. The trail is read from `nav-items.ts` — group
 * caption, then item — and a page about one thing appends that thing's name with
 * `TopbarCrumb`; the item before it then becomes a link back.
 *
 * **Page actions arrive through `TopbarActions`**, portalled into the box on the right
 * so they keep the page's state. That reverses an earlier rule that this bar held only
 * what is true on every route: the frame now follows the Linear pattern, where the
 * topbar is the screen's toolbar, and language and theme moved to Settings ›
 * Appearance.
 *
 * The sidebar trigger is gone below `md`: the bottom tab bar is the navigation there.
 */
export function AppTopbar() {
  const t = useTranslate();
  const place = navPlaceFor(usePathname());
  const slots = useChromeSlots();
  const trailing = slots?.trailingCrumb ?? null;

  const crumbs: { key: string; label: string; href?: React.ComponentProps<typeof Link>['href'] }[] =
    [];
  if (place) {
    crumbs.push({ key: 'group', label: t(place.group.labelKey) });
    crumbs.push({
      key: 'item',
      label: t(place.item.labelKey),
      href: trailing ? place.item.href : undefined,
    });
  }
  if (trailing) crumbs.push({ key: 'trailing', label: trailing });

  return (
    <div
      data-slot="app-topbar"
      className="border-hairline bg-background flex h-12 shrink-0 items-center gap-3 border-b px-4"
    >
      {/* `aria-label` rather than the primitive's own `sr-only` span, which is the one
          string in this chrome the CLI hard-codes in English. */}
      <SidebarTrigger aria-label={t('web.chrome.toggleSidebar')} className="max-md:hidden" />
      {crumbs.length > 0 ? (
        <Breadcrumb aria-label={t('web.chrome.breadcrumb')} className="min-w-0 flex-1">
          <BreadcrumbList className="flex-nowrap">
            {crumbs.map((crumb, index) => {
              const last = index === crumbs.length - 1;
              // On a phone the group caption and the separator after it go first.
              const phoneHidden = crumbs.length > 1 && index <= 1 ? 'max-sm:hidden' : undefined;
              return (
                <Fragment key={crumb.key}>
                  {index > 0 ? (
                    <BreadcrumbSeparator className={index === 1 ? phoneHidden : undefined} />
                  ) : null}
                  <BreadcrumbItem className={index === 0 ? phoneHidden : undefined}>
                    {last ? (
                      <h1
                        aria-current="page"
                        className="text-foreground truncate text-body font-semibold tracking-tight"
                      >
                        {crumb.label}
                      </h1>
                    ) : crumb.href ? (
                      <BreadcrumbLink asChild>
                        <Link href={crumb.href} className="truncate">
                          {crumb.label}
                        </Link>
                      </BreadcrumbLink>
                    ) : (
                      <span className="truncate">{crumb.label}</span>
                    )}
                  </BreadcrumbItem>
                </Fragment>
              );
            })}
          </BreadcrumbList>
        </Breadcrumb>
      ) : (
        <div className="flex-1" />
      )}
      {/* The landing box for `TopbarActions`. Always rendered, so a page's portal has
          somewhere to go on its first render after this one. */}
      <div
        ref={slots?.setActionsTarget}
        data-slot="topbar-actions"
        className="flex shrink-0 items-center gap-2"
      />
    </div>
  );
}
