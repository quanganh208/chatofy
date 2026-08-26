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
import { useSession } from 'next-auth/react';
import { updateMe } from '@/clients/api-client';
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
 *
 * ## Mail follows the same choice, and is not a second setting
 *
 * A signed-in switch also writes `User.locale`, which is what the four auth emails are
 * composed in. They could have been separable — read the UI in English, get mail in
 * Vietnamese — and that was rejected: two language settings a user has to reconcile is
 * a worse product than one, on a tool with one language pair, and the failure it
 * prevents (mail arriving in the language you did not pick) is not a failure anyone
 * has. Recorded here because "why is there no mail-language control" is a fair
 * question to ask this file.
 *
 * The write is fire-and-forget. If it fails the UI language still changed, which is
 * what the click asked for; blocking the switch on a round trip would make a language
 * change feel like a save. The next successful switch writes it again.
 */
const LABEL_KEY = {
  vi: 'common.language.vietnamese',
  en: 'common.language.english',
} as const satisfies Record<Locale, string>;

export function LocaleSwitcher({ className }: { className?: string }) {
  const router = useRouter();
  const active = useLocale();
  const t = useTranslate();
  const { status } = useSession();

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
              // Only when there is a row to write to. Signed out, the cookie is the
              // whole story — and a 401 here would be noise, not a failure.
              if (status === 'authenticated') void updateMe({ locale }).catch(() => {});
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
