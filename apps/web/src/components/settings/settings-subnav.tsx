'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslate } from '@/i18n/provider';
import { cn } from '@/lib/utils';
import { SETTINGS_SECTION_GROUPS, SETTINGS_SECTIONS } from './settings-sections';

/**
 * The settings sub-navigation: two captioned groups in a column beside the content
 * from `lg`, one horizontally scrolling row of links above it below that.
 *
 * `lg`, not `md`: from `md` the app sidebar is open too, and at 768px a second column
 * beside it left the content about 250px — a row's note wrapped one word per line.
 *
 * Two renderings of one list rather than one that restyles itself, because the two
 * shapes differ in more than layout: the column carries the group captions, and the
 * phone row drops them — a caption in a scrolling strip reads as one more link.
 *
 * The active link is marked with `aria-current="page"` and a quiet `secondary`
 * ground, never `bg-primary`: the sub-nav is where you are, not the screen's action.
 */
export function SettingsSubnav() {
  const t = useTranslate();
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const row = useRef<HTMLUListElement>(null);

  // On a phone the row is wider than the screen, and Profile, Billing and Security
  // start off it, so the current page is scrolled into the middle of the row — or the
  // reader lands on a page whose own tab they cannot see. The row is `relative` so it
  // is the offset parent the links measure from.
  useEffect(() => {
    const strip = row.current;
    const current = strip?.querySelector<HTMLElement>('a[aria-current="page"]');
    if (!strip || !current) return;
    strip.scrollLeft = current.offsetLeft - (strip.clientWidth - current.offsetWidth) / 2;
  }, [pathname]);

  const linkClass = (active: boolean) =>
    cn(
      'text-body flex items-center gap-2.5 rounded-md px-2.5 py-1.5 whitespace-nowrap transition-colors duration-fast ease-standard motion-reduce:transition-none pointer-coarse:min-h-11',
      'focus-visible:ring-ring/50 outline-none focus-visible:ring-[3px]',
      active
        ? 'bg-secondary text-foreground font-medium'
        : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
    );

  return (
    <nav aria-label={t('web.settings.nav')} className="lg:w-48 lg:shrink-0">
      {/* Phone and small tablet: one row of every section, scrolled sideways. */}
      <ul
        ref={row}
        className="border-hairline relative -mx-1 flex gap-1 overflow-x-auto border-b px-1 pb-2 lg:hidden"
      >
        {SETTINGS_SECTIONS.map((section) => {
          const active = isActive(section.href);
          return (
            <li key={section.id} className="shrink-0">
              <Link
                href={section.href}
                aria-current={active ? 'page' : undefined}
                className={linkClass(active)}
              >
                {t(section.labelKey)}
              </Link>
            </li>
          );
        })}
      </ul>

      {/* From `lg`: the column, grouped. */}
      <div className="hidden flex-col gap-5 lg:flex">
        {SETTINGS_SECTION_GROUPS.map((group) => (
          <div key={group.labelKey} className="flex flex-col gap-1">
            <span className="text-muted-foreground text-hint px-2.5 font-medium">
              {t(group.labelKey)}
            </span>
            <ul className="flex flex-col gap-0.5">
              {group.sections.map((section) => {
                const active = isActive(section.href);
                const Icon = section.icon;
                return (
                  <li key={section.id}>
                    <Link
                      href={section.href}
                      aria-current={active ? 'page' : undefined}
                      className={linkClass(active)}
                    >
                      <Icon aria-hidden className="size-4 shrink-0" />
                      {t(section.labelKey)}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
