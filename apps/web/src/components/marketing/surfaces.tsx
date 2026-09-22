import { dawn } from '@chatofy/ui';
import { getT } from '@/i18n/server';
import { Section } from './section';

/** The tiles' decorative band — the dawn trio, left to right. */
const DAWN_BAND = `linear-gradient(90deg, ${dawn.peach}, ${dawn.lavender}, ${dawn.mint})`;

/**
 * The three places this runs, all of which exist in this repository.
 *
 * No install links: the extension is a load-unpacked build and the mobile app an Expo
 * one, so a button here would point at nothing. What each tile claims is what the surface is FOR, and all three are
 * traceable to the README.
 *
 * Tiles on the page ground, each topped with a thin dawn band — decoration, never under
 * text, and the only colour in this section. Not cards and not icon circles: the three
 * are read side by side and compared, not acted on as units.
 */
export async function Surfaces() {
  const t = await getT();

  const surfaces = [
    {
      title: t('web.landing.surfaceBrowserTitle'),
      body: t('web.landing.surfaceBrowserBody'),
    },
    {
      title: t('web.landing.surfaceExtensionTitle'),
      body: t('web.landing.surfaceExtensionBody'),
    },
    {
      title: t('web.landing.surfacePhoneTitle'),
      body: t('web.landing.surfacePhoneBody'),
    },
  ];

  return (
    <Section id="where-it-runs" title={t('web.landing.surfacesTitle')}>
      <div className="grid gap-8 md:grid-cols-3">
        {surfaces.map((surface) => (
          <div key={surface.title} className="flex flex-col gap-3">
            <span
              aria-hidden
              className="h-1 w-12 rounded-full"
              style={{ backgroundImage: DAWN_BAND }}
            />
            <h3 className="text-body mt-1 font-medium tracking-tight">{surface.title}</h3>
            <p className="text-prose text-hint">{surface.body}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}
