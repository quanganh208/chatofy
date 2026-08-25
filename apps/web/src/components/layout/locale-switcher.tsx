'use client';

import { useRouter } from 'next/navigation';
import { Check, Languages } from 'lucide-react';
import { LOCALES, type Locale } from '@chatofy/i18n';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@chatofy/ui/react';
import { localeCookie } from '@/i18n/locale-cookie';
import { useLocale, useTranslate } from '@/i18n/provider';

/**
 * Switching language: write the cookie, then ask the server to render again.
 *
 * **It does not flip a value in the provider.** The locale is resolved on the server
 * and handed down, so the only way to change it is to change what the server resolves.
 * `router.refresh()` re-renders every server component with the new cookie in place
 * and — this is why it is preferred over a navigation — keeps client state: a
 * conversation in progress on `/translate` survives the switch.
 *
 * Hence the cookie is not `httpOnly`. That exception is recorded in
 * `locale-cookie.ts`; the short version is that the value is one of two public strings
 * and authorises nothing.
 *
 * `/locale?lang=…` exists for the other case — a link that pins a language for someone
 * who has not been here before. Same cookie, set by the server.
 *
 * The labels are each written in their OWN language, never translated. Someone looking
 * for Vietnamese is looking for the word "Tiếng Việt"; rendering it as "Vietnamese"
 * because the page is currently English hides it from exactly the person who needs it.
 */
const LABEL_KEY = {
  vi: 'common.language.vietnamese',
  en: 'common.language.english',
} as const satisfies Record<Locale, string>;

export function LocaleSwitcher({ className }: { className?: string }) {
  const router = useRouter();
  const active = useLocale();
  const t = useTranslate();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={className ?? 'size-8'}
          aria-label={t('common.language.label')}
        >
          <Languages aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {LOCALES.map((locale) => (
          <DropdownMenuItem
            key={locale}
            onSelect={() => {
              document.cookie = localeCookie(locale);
              router.refresh();
            }}
          >
            <Check aria-hidden className={locale === active ? undefined : 'invisible'} />
            {t(LABEL_KEY[locale])}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
