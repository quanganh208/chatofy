import { Globe, Puzzle, Smartphone } from 'lucide-react';
import { Card, CardContent } from '@chatofy/ui/react';
import { getT } from '@/i18n/server';
import { Section } from './section';

/**
 * The three places this runs, all of which exist in this repository.
 *
 * No install links, for the same reason the dashboard's version has none: the extension
 * is a load-unpacked build and the mobile app an Expo one, so a button here would point
 * at nothing. What each card claims is what the surface is FOR, and all three are
 * traceable to the README.
 */
export function Surfaces() {
  const t = getT();

  const surfaces = [
    {
      icon: Globe,
      title: t('web.landing.surfaceBrowserTitle'),
      body: t('web.landing.surfaceBrowserBody'),
    },
    {
      icon: Puzzle,
      title: t('web.landing.surfaceExtensionTitle'),
      body: t('web.landing.surfaceExtensionBody'),
    },
    {
      icon: Smartphone,
      title: t('web.landing.surfacePhoneTitle'),
      body: t('web.landing.surfacePhoneBody'),
    },
  ];

  return (
    <Section id="where-it-runs" title={t('web.landing.surfacesTitle')}>
      <div className="grid gap-6 md:grid-cols-3">
        {surfaces.map((surface) => (
          <Card key={surface.title}>
            <CardContent className="flex flex-col gap-3">
              <surface.icon aria-hidden className="text-muted-foreground size-5" />
              <h3 className="text-body font-semibold tracking-tight">{surface.title}</h3>
              <p className="text-prose text-hint">{surface.body}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </Section>
  );
}
