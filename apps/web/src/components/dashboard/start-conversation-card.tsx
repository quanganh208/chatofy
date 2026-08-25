'use client';

import Link from 'next/link';
import { Mic } from 'lucide-react';
import { Button, Card, CardContent, DirectionToggle } from '@chatofy/ui/react';
import { useTranslateSettings } from '@/hooks/use-translate-settings';
import { useTranslate } from '@/i18n/provider';
import { directionLabels, makeLanguageName } from '@/i18n/direction-labels';
import { CardEyebrow } from './card-eyebrow';

/**
 * The one decision worth making before entering a conversation, and the way in.
 *
 * **Direction only.** The settings object is edited in the translate popover and, from
 * Phase 8, at `/preferences`; a third full copy here would be three surfaces writing
 * one storage key. Direction earns the exception because it is the choice you make
 * *before* you start talking rather than during — everything else (voice, rate,
 * volume) is adjusted while listening to the result.
 *
 * `useTranslateSettings` is called here, and this is the SECOND call site in the app.
 * That is safe and the rule is worth restating precisely: it is one call site per
 * page, not one per app. This page and `/translate` never mount together, so the two
 * copies never coexist and cannot diverge — the storage read on mount is always the
 * other page's last write.
 *
 * The button carries nothing to `/translate`. The settings are already persisted, so
 * passing them in the URL would create a second source of truth for one storage key
 * and a link that could be shared with someone else's direction baked into it.
 */
export function StartConversationCard() {
  const t = useTranslate();
  const { settings, set } = useTranslateSettings();

  return (
    <Card>
      <CardContent className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <CardEyebrow>{t('web.dashboard.start')}</CardEyebrow>
          <h2 className="text-title font-semibold tracking-tight">
            {t('web.dashboard.startConversation')}
          </h2>
        </div>

        <div className="max-w-md">
          <DirectionToggle
            value={settings.direction}
            onChange={(direction) => set({ direction })}
            labels={directionLabels(t)}
            nameLanguage={makeLanguageName(t)}
          />
        </div>

        <div className="flex flex-wrap items-center gap-4">
          {/* The page's one accent-filled control. Everything else on the hub is a
              readout, and a second filled button would make them look equivalent. */}
          <Button asChild size="lg">
            <Link href="/translate">
              <Mic aria-hidden /> {t('web.translate.startTranslating')}
            </Link>
          </Button>
          <p className="text-hint text-muted-foreground max-w-prose">
            {t('web.dashboard.startHint')}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
