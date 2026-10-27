'use client';

import { useRouter } from 'next/navigation';
import { Languages } from 'lucide-react';
import { LOCALES, type Locale } from '@chatofy/i18n';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
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

/**
 * `showValue` draws the active language beside the icon. The chrome's icon is
 * enough where the whole page is the readout; in a settings row it is not — the
 * theme control beside it shows its state, and a bare icon left "which language
 * is this set to?" answerable only by opening the menu.
 */
export function LocaleSwitcher({
  className,
  showValue = false,
}: {
  className?: string;
  showValue?: boolean;
}) {
  const router = useRouter();
  const active = useLocale();
  const t = useTranslate();
  const { status } = useSession();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {showValue ? (
          // The visible name is part of the accessible one (WCAG 2.5.3), so a voice
          // user saying what they see still reaches it.
          <Button
            variant="ghost"
            size="sm"
            className={className}
            aria-label={`${t('common.language.label')}: ${t(LABEL_KEY[active])}`}
          >
            <Languages aria-hidden />
            {t(LABEL_KEY[active])}
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            className={className ?? 'size-8'}
            aria-label={t('common.language.label')}
          >
            <Languages aria-hidden />
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {/* A radio group, so the active language is announced as checked rather
            than marked by a tick only sighted readers can see. */}
        <DropdownMenuRadioGroup
          value={active}
          onValueChange={(next) => {
            const locale = next as Locale;
            document.cookie = localeCookie(locale);
            router.refresh();
            if (status === 'authenticated') void updateMe({ locale }).catch(() => {});
          }}
        >
          {LOCALES.map((locale) => (
            <DropdownMenuRadioItem key={locale} value={locale}>
              {t(LABEL_KEY[locale])}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
