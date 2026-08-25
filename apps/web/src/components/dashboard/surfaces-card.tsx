'use client';

import { Puzzle, Smartphone } from 'lucide-react';
import { Card, CardContent } from '@chatofy/ui/react';
import { useTranslate } from '@/i18n/provider';
import { CardEyebrow } from './card-eyebrow';

/**
 * The other two places this translator runs.
 *
 * Both are real and in this repository — `apps/extension` is the Chrome MV3 meeting
 * translator, `apps/mobile` the Expo app. Neither is published to a store, so neither
 * row carries an install button: a CTA whose destination does not exist is exactly the
 * placeholder this page is not allowed to have. The mockup draws "Install" and "View"
 * buttons; they land when there is somewhere for them to land.
 *
 * What each row says instead is what the surface does and that it is not released.
 * That is the honest version of the same information, and it is still the reason the
 * card is here — someone who translates meetings should know the extension exists.
 */

const SURFACES = [
  {
    icon: Puzzle,
    nameKey: 'web.dashboard.extension',
    whatKey: 'web.dashboard.extensionWhat',
  },
  {
    icon: Smartphone,
    nameKey: 'web.dashboard.mobile',
    whatKey: 'web.dashboard.mobileWhat',
  },
] as const;

export function SurfacesCard() {
  const t = useTranslate();

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <CardEyebrow>{t('web.dashboard.alsoRunsOn')}</CardEyebrow>
        <div className="flex flex-col gap-4">
          {SURFACES.map((surface) => (
            <div
              key={surface.nameKey}
              className="border-hairline flex flex-col gap-1 border-b pb-4 last:border-b-0 last:pb-0"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-body flex items-center gap-2 font-medium">
                  <surface.icon aria-hidden className="size-4 shrink-0" />
                  {t(surface.nameKey)}
                </span>
                <span className="text-hint text-muted-foreground">
                  {t('web.dashboard.unreleased')}
                </span>
              </div>
              <p className="text-hint text-prose max-w-prose">{t(surface.whatKey)}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
