'use client';

import { ALargeSmall, Copy } from 'lucide-react';
import type { ColorScheme } from '@chatofy/ui';
import { Separator, Switch } from '@chatofy/ui/react';
import { AppearanceSettingsPanel } from '@/components/translate/appearance-settings-panel';
import { SettingsRow } from '@/components/translate/settings-row';
import { TextSizeField } from '@/components/translate/text-size-field';
import { DEFAULT_STAGE_APPEARANCE, type StageAppearance } from '@/lib/translate-settings';
import { pickReadingAppearance, type ReadingAppearance } from '@/lib/reading-appearance';
import { useTranslate } from '@/i18n/provider';

/**
 * The look of fullscreen and the caption window.
 *
 * "Same as page" on hides every editor below it rather than disabling them — a
 * control that does not apply is absent (`display-settings-panel.tsx`). The
 * stored stage values survive it: switching back returns the captions as they
 * were set, not the defaults.
 */
export function StageSettingsPanel({
  stage,
  scheme,
  onChange,
}: {
  stage: StageAppearance;
  scheme: ColorScheme;
  onChange: (stage: StageAppearance) => void;
}) {
  const t = useTranslate();
  const { followPage, textSize } = stage;
  const appearance = pickReadingAppearance(stage);
  const defaults = pickReadingAppearance(DEFAULT_STAGE_APPEARANCE);

  return (
    <div className="flex flex-col gap-5">
      <SettingsRow icon={Copy} label={t('web.translate.stageFollowPage')}>
        <Switch
          aria-label={t('web.translate.stageFollowPage')}
          checked={followPage}
          onCheckedChange={(next) => onChange({ ...stage, followPage: next })}
        />
      </SettingsRow>

      {followPage ? null : (
        <>
          <SettingsRow icon={ALargeSmall} label={t('web.translate.textSize')}>
            <TextSizeField
              label={t('web.translate.textSize')}
              value={textSize}
              onChange={(next) => onChange({ ...stage, textSize: next })}
            />
          </SettingsRow>
          <Separator />
          <AppearanceSettingsPanel
            appearance={appearance}
            defaults={defaults}
            scheme={scheme}
            onChange={(patch: Partial<ReadingAppearance>) => onChange({ ...stage, ...patch })}
            // The stage's size is part of its look, so Reset returns it too.
            onReset={() => onChange({ ...DEFAULT_STAGE_APPEARANCE, followPage })}
          />
        </>
      )}
    </div>
  );
}
