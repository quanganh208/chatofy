import Link from 'next/link';
import type { Route } from 'next';
import { LANGUAGE_CODES } from '@chatofy/types';
import { getT } from '@/i18n/server';
import { cn } from '@/lib/utils';
import { Brand } from './brand';
import { MEASURE } from './measures';

/** A route is a `Link`; an in-page anchor or a file is a plain `a`. */
type FooterLink = { label: string } & (
  { kind: 'route'; href: Route } | { kind: 'plain'; href: string }
);

/**
 * The public footer: the mark, then four short columns.
 *
 * Every link goes somewhere that exists. Product is the three public-facing routes
 * (the translator and meetings bounce a signed-out visitor to sign in, which is the
 * right answer for them). "On this page" is the landing's own sections, absolute so they
 * still land on `/` when this footer is drawn on `/pricing`. Resources are the
 * machine-readable twins the pages already advertise — `/llms.txt`, `/index.md`,
 * `/pricing.md` — plain anchors, because they are files rather than routes. There are no
 * legal pages, social accounts or company links, because there are none to point at.
 *
 * The languages column reads the registry and names each language in the reader's
 * interface language, so a language added there appears here without an edit.
 */
export async function MarketingFooter() {
  const t = await getT();

  const columns: { title: string; links: FooterLink[] }[] = [
    {
      title: t('web.landing.footerProduct'),
      links: [
        { kind: 'route', href: '/translate/one-way', label: t('common.nav.translate') },
        { kind: 'route', href: '/conference', label: t('web.chrome.navConference') },
        { kind: 'route', href: '/pricing', label: t('web.pricing.title') },
      ],
    },
    {
      title: t('web.landing.footerOnThisPage'),
      links: [
        { kind: 'plain', href: '/#modes', label: t('web.landing.navModes') },
        { kind: 'plain', href: '/#how-it-works', label: t('web.landing.navHow') },
        { kind: 'plain', href: '/#use-cases', label: t('web.landing.navUseCases') },
        { kind: 'plain', href: '/#privacy', label: t('web.landing.navLocal') },
        { kind: 'plain', href: '/#where-it-runs', label: t('web.landing.navSurfaces') },
        { kind: 'plain', href: '/#faq', label: t('web.landing.navFaq') },
      ],
    },
    {
      title: t('web.landing.footerResources'),
      links: [
        { kind: 'plain', href: '/llms.txt', label: 'llms.txt' },
        { kind: 'plain', href: '/index.md', label: t('web.landing.footerMarkdownHome') },
        { kind: 'plain', href: '/pricing.md', label: t('web.landing.footerMarkdownPricing') },
      ],
    },
  ];
  const languages = LANGUAGE_CODES.map((code) => t(`common.languageName.${code}`));

  const linkClass =
    'text-body text-prose hover:text-foreground focus-visible:ring-ring/50 rounded-sm focus-visible:ring-[3px] focus-visible:outline-none';

  return (
    <footer className="border-hairline border-t">
      <div
        className={cn(
          'mx-auto grid w-full gap-10 px-6 py-12 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))]',
          MEASURE.marketing,
        )}
      >
        <div className="sm:col-span-2 lg:col-span-1">
          <Brand />
        </div>
        {columns.map((column) => (
          <nav key={column.title} aria-label={column.title} className="flex flex-col gap-3">
            <h2 className="text-hint text-muted-foreground font-medium">{column.title}</h2>
            <ul className="flex flex-col gap-2">
              {column.links.map((link) => (
                <li key={link.href}>
                  {link.kind === 'route' ? (
                    <Link href={link.href} className={linkClass}>
                      {link.label}
                    </Link>
                  ) : (
                    <a href={link.href} className={linkClass}>
                      {link.label}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        ))}
        <div className="flex flex-col gap-3">
          <h2 className="text-hint text-muted-foreground font-medium">
            {t('web.landing.footerLanguages')}
          </h2>
          <ul className="flex flex-col gap-2">
            {languages.map((language) => (
              <li key={language} className="text-body text-prose">
                {language}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </footer>
  );
}
