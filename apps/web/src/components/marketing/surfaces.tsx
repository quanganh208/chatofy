import { Globe, Puzzle, Smartphone } from 'lucide-react';
import { dawn } from '@chatofy/ui';
import { Badge } from '@chatofy/ui/react';
import { getT } from '@/i18n/server';
import { Reveal } from '@/components/motion/reveal';
import { Section } from './section';

/** The tiles' decorative band — the dawn trio, left to right. */
const DAWN_BAND = `linear-gradient(90deg, ${dawn.peach}, ${dawn.lavender}, ${dawn.mint})`;

/**
 * The three places this runs, all of which exist in this repository.
 *
 * The browser holds both the translator and meetings. The extension translates a call
 * the reader already has — Meet, Zoom's web client or Facebook. The phone tile says "in
 * development" because the mobile app joins meetings only in development builds and is in
 * no store; a tile promising more would be the one false line on the page.
 *
 * Each tile carries its status as a quiet outline badge, so the three are comparable at
 * a glance: available now, not in the Chrome Web Store yet (it is a load-unpacked build),
 * in development. A readout, never a control — the badge is a `span`.
 *
 * No install links: the extension is a load-unpacked build and the mobile app an Expo
 * one, so a button here would point at nothing. What each tile claims is what the surface
 * is FOR, and all three are traceable to the README.
 *
 * Tiles on the page ground, each topped with a thin dawn band — decoration, never under
 * text, and the only colour in this section. Not cards and not icon circles: the three
 * are read side by side and compared, not acted on as units.
 */
export async function Surfaces() {
  const t = await getT();

  const surfaces = [
    {
      Icon: Globe,
      title: t('web.landing.surfaceBrowserTitle'),
      body: t('web.landing.surfaceBrowserBody'),
      status: t('web.landing.surfaceStatusBrowser'),
    },
    {
      Icon: Puzzle,
      title: t('web.landing.surfaceExtensionTitle'),
      body: t('web.landing.surfaceExtensionBody'),
      status: t('web.landing.surfaceStatusExtension'),
    },
    {
      Icon: Smartphone,
      title: t('web.landing.surfacePhoneTitle'),
      body: t('web.landing.surfacePhoneBody'),
      status: t('web.landing.surfaceStatusPhone'),
    },
  ];

  return (
    <Section id="where-it-runs" title={t('web.landing.surfacesTitle')}>
      <div className="grid gap-4 md:grid-cols-3">
        {surfaces.map((surface, index) => (
          <Reveal key={surface.title} delay={index * 90}>
            <div className="border-hairline flex h-full flex-col gap-3 rounded-2xl border p-6">
              <span
                aria-hidden
                className="h-1 w-12 rounded-full"
                style={{ backgroundImage: DAWN_BAND }}
              />
              <span
                aria-hidden
                className="bg-muted text-foreground flex size-10 shrink-0 items-center justify-center rounded-full"
              >
                <surface.Icon className="size-5" />
              </span>
              <h3 className="text-heading font-display tracking-tight">{surface.title}</h3>
              <p className="text-prose text-body">{surface.body}</p>
              {/* At the foot, so the three line up; allowed to wrap, because a status
                  this long does not fit a third of a tablet on one line. */}
              <Badge variant="outline" className="mt-auto rounded-full text-left whitespace-normal">
                {surface.status}
              </Badge>
            </div>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
