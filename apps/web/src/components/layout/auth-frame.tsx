import { CheckIcon } from 'lucide-react';
import { LotusIllustration } from '@/components/marketing/lotus-illustration';
import { getT } from '@/i18n/server';
import type { MessageKey } from '@chatofy/i18n';
import { Brand } from './brand';
import { ConnectedThemeToggle } from './theme-toggle-connected';

/** What the panel promises, in the order someone meets it in the product. */
const BENEFITS = [
  'web.auth.panelBenefitLive',
  'web.auth.panelBenefitTranscript',
  'web.auth.panelBenefitMeetings',
] as const satisfies readonly MessageKey[];

/**
 * The frame for the auth routes: a brand panel beside the form from `lg` up, and the
 * form alone below it.
 *
 * It keeps every property `PlainFrame` gave these routes, because those were the
 * requirement rather than the styling: the brand as a way home, the theme toggle, and
 * **no navigation and no session anything** — so a sign-out control still cannot
 * appear on a password-reset page. What it adds is the half of the screen the old
 * single column left empty.
 *
 * The panel is a region on its own ground (`muted`), separated by a hairline and
 * carrying no shadow, so it is not an elevated surface: the form's card stays the
 * screen's one. Dawn reaches it only through the lotus illustration, which stands
 * ABOVE the copy and never behind it — a dawn value measures 1.3–1.7:1 on stone and
 * must not be what a sentence is read against. The panel's text is `prose` on `muted`,
 * which clears 4.5:1 in both schemes.
 *
 * Below `lg` the panel is hidden (`display: none`; it is still in the HTML), so a phone
 * does not scroll past a picture to reach the form; the header's mark carries the brand
 * there. There is still one illustration per page, so its fixed gradient ids are never
 * duplicated.
 */
export async function AuthFrame({ children }: { children: React.ReactNode }) {
  const t = await getT();

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <aside className="bg-muted border-hairline hidden flex-col gap-12 border-r px-12 py-10 lg:flex">
        <Brand size={32} />
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-10">
          <LotusIllustration className="max-w-sm" />
          <div className="flex flex-col gap-6">
            <p className="text-display font-display text-foreground font-light tracking-tight">
              {t('web.auth.panelTagline')}
            </p>
            <ul className="text-prose text-body flex flex-col gap-3">
              {BENEFITS.map((key) => (
                <li key={key} className="flex items-start gap-3">
                  <CheckIcon aria-hidden className="text-foreground mt-0.5 size-4 shrink-0" />
                  <span>{t(key)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </aside>

      <div className="flex min-h-screen min-w-0 flex-col">
        {/* `border-hairline`, like every other surface separation, and only while the
            header sits over the form column alone; beside the panel it would draw a
            rule across half a screen for no boundary. */}
        <header className="border-hairline flex items-center gap-4 border-b px-6 py-4 lg:border-b-0">
          <Brand className="lg:hidden" />
          <div className="ml-auto flex items-center gap-2">
            <ConnectedThemeToggle />
          </div>
        </header>

        <main
          id="main"
          tabIndex={-1}
          className="flex flex-1 justify-center px-6 py-8 md:items-center md:py-12"
        >
          <div className="flex w-full max-w-md flex-col gap-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
