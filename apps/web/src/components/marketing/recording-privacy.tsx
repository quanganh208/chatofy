import { Check, ShieldCheck } from 'lucide-react';
import { getT } from '@/i18n/server';

/**
 * The privacy notice — the product has no other one, so this section IS it.
 *
 * It says what the translator receives and what is kept, and deliberately makes no claim
 * about where speech is processed. It used to: three "on device / over the network" hops
 * promised the voice was heard on the reader's own computer. That held for a self-hosted
 * checkout and not for anyone using the hosted service, where speech runs on Chatofy's
 * server. The facts that stay true whatever the hosting are the ones below.
 *
 * Written as what happens to the reader's recording rather than as what runs where — the
 * register rule wants the outcome, not the pipeline wearing a privacy hat. One fact per
 * line: at phone width the part a reader would be surprised by later — kept, by link,
 * through a pause — must not sit in the middle of a paragraph.
 *
 * ## Dark in both themes
 *
 * The band changes the page's key so the notice reads as a different kind of content,
 * not as one more feature tile. It is a `reading-scheme-dark` island: the token block in
 * `globals.css` is re-declared on that class, so every `light-dark()` pair resolves dark
 * inside it whatever the page is in. An inline `color-scheme` alone could not do this —
 * tokens resolve where they are declared, and on `:root` they arrive already resolved.
 *
 * Inside it every colour is read from the RAW token (`var(--card)`, `var(--prose)`),
 * the same discipline as `theme-choice-tiles.tsx`: the `--color-*` aliases behind the
 * ordinary utilities are declared on `:root` and would carry the page's scheme in.
 * Ground is the dark `card`, one step above the dark page, so the band still reads as a
 * band in the dark theme. Text on it: `foreground` 16.0:1, `prose` 9.6:1,
 * `muted-foreground` 6.9:1 — all past 4.5:1.
 *
 * Not elevated: no shadow, so the surface count is unchanged.
 */
export async function RecordingPrivacy() {
  const t = await getT();

  const kept = [
    t('web.landing.localKeptHistory'),
    t('web.landing.localKeptLink'),
    t('web.landing.localKeptPause'),
    t('web.landing.localKeptDelete'),
    t('web.landing.localKeptMeeting'),
  ];

  return (
    <section id="privacy" className="scroll-mt-24 py-16">
      <div className="reading-scheme-dark grid gap-10 rounded-3xl bg-[var(--card)] px-6 py-12 text-[var(--foreground)] sm:px-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:gap-16 lg:px-14 lg:py-16">
        <div className="flex max-w-prose flex-col gap-4">
          <span
            aria-hidden
            className="flex size-11 items-center justify-center rounded-full bg-[var(--muted)] text-[var(--foreground)]"
          >
            <ShieldCheck className="size-5" />
          </span>
          <h2 className="text-title font-display font-light tracking-tight text-balance">
            {t('web.landing.localTitle')}
          </h2>
          <p className="text-body text-[var(--prose)]">{t('web.landing.localBody')}</p>
        </div>
        <ul className="flex flex-col">
          {kept.map((fact) => (
            <li
              key={fact}
              className="text-body flex gap-3 border-b border-[var(--border)] py-4 text-[var(--prose)] first:pt-0 last:border-b-0 last:pb-0"
            >
              <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-[var(--foreground)]" />
              <span className="min-w-0">{fact}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
