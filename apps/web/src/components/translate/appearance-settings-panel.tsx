'use client';

import { Clock, RotateCcw } from 'lucide-react';
import type { ColorScheme } from '@chatofy/ui';
import { Button, SegmentedControl, Separator, Slider, Switch } from '@chatofy/ui/react';
import { ReadingColorField } from '@/components/translate/reading-color-field';
import { SettingsRow } from '@/components/translate/settings-row';
import {
  GROUND_PRESETS,
  INK_PRESETS,
  INK_SLOTS,
  OPACITY_STEP,
  READING_ALIGNS,
  READING_FONTS,
  READING_LEADINGS,
  READING_WEIGHTS,
  inkContrast,
  type GroundPreset,
  type InkPreset,
  type InkSlot,
  type ReadingAppearance,
  type ReadingFont,
} from '@/lib/reading-appearance';
import { useTranslate } from '@/i18n/provider';
import type { MessageKey } from '@chatofy/i18n';

const INK_LABEL: Record<InkSlot, MessageKey> = {
  targetColor: 'web.translate.colorTarget',
  sourceColor: 'web.translate.colorSource',
  speakerColor: 'web.translate.colorSpeaker',
  timeColor: 'web.translate.colorTime',
};

const FONT_LABEL: Record<ReadingFont, MessageKey> = {
  sans: 'web.translate.fontSans',
  serif: 'web.translate.fontSerif',
  mono: 'web.translate.fontMono',
  legible: 'web.translate.fontLegible',
};

/** Each face's label drawn IN that face, so the choice previews itself. */
const FONT_PREVIEW: Record<ReadingFont, string> = {
  sans: 'var(--font-sans)',
  serif: 'var(--font-newsreader), serif',
  mono: 'ui-monospace, monospace',
  legible: 'var(--font-legible), var(--font-sans)',
};

/**
 * One reader appearance — the page's or the stage's, the same editor for both.
 *
 * Every row applies on the screen behind the popover as it changes, which is why
 * none of them carries a sentence: the panel note in `display-settings-panel.tsx`
 * explains that rule, and the one exception is the same here — the contrast
 * warning, which is a control refusing to vouch for a choice.
 *
 * The opacity slider exists only once there is a background to make translucent.
 * It is absent, not disabled, under "default", for the panel's other rule.
 *
 * Reset returns this appearance to the defaults it was given, which differ
 * between page and stage — the stage starts as captions.
 */
export function AppearanceSettingsPanel({
  appearance,
  defaults,
  scheme,
  onChange,
  onReset = () => onChange(defaults),
}: {
  appearance: ReadingAppearance;
  defaults: ReadingAppearance;
  scheme: ColorScheme;
  onChange: (patch: Partial<ReadingAppearance>) => void;
  /** What Reset restores, when it is more than this appearance — the stage's size. */
  onReset?: () => void;
}) {
  const t = useTranslate();
  const presetLabel = (preset: InkPreset | GroundPreset) =>
    t(`web.translate.colorPreset.${preset}` as MessageKey);

  return (
    <div className="flex flex-col gap-5">
      {INK_SLOTS.map((slot) => (
        <ReadingColorField
          key={slot}
          label={t(INK_LABEL[slot])}
          value={appearance[slot]}
          presets={INK_PRESETS}
          presetLabel={presetLabel}
          contrast={inkContrast(appearance, slot, scheme)}
          scheme={scheme}
          onChange={(value) => onChange({ [slot]: value })}
        />
      ))}

      <ReadingColorField
        label={t('web.translate.background')}
        value={appearance.background}
        presets={GROUND_PRESETS}
        presetLabel={presetLabel}
        scheme={scheme}
        onChange={(background) => onChange({ background })}
      />
      {appearance.background === 'default' ? null : (
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <span className="text-body font-medium">{t('web.translate.backgroundOpacity')}</span>
            <span className="text-muted-foreground text-label tabular-nums">
              {appearance.backgroundOpacity}%
            </span>
          </div>
          <Slider
            aria-label={t('web.translate.backgroundOpacity')}
            value={[appearance.backgroundOpacity]}
            min={0}
            max={100}
            step={OPACITY_STEP}
            stepped
            onValueChange={([next]) => {
              if (next !== undefined) onChange({ backgroundOpacity: next });
            }}
          />
        </div>
      )}

      <Separator />

      <SegmentedControl
        label={t('web.translate.font')}
        value={appearance.font}
        equalWidth
        options={READING_FONTS.map((font) => ({
          value: font,
          label: <span style={{ fontFamily: FONT_PREVIEW[font] }}>{t(FONT_LABEL[font])}</span>,
        }))}
        onChange={(font) => onChange({ font })}
      />
      <SegmentedControl
        label={t('web.translate.lineHeight')}
        value={appearance.lineHeight}
        equalWidth
        options={READING_LEADINGS.map((lineHeight) => ({
          value: lineHeight,
          label: t(
            lineHeight === 'compact'
              ? 'web.translate.lineHeightCompact'
              : lineHeight === 'normal'
                ? 'web.translate.lineHeightNormal'
                : 'web.translate.lineHeightRelaxed',
          ),
        }))}
        onChange={(lineHeight) => onChange({ lineHeight })}
      />
      <SegmentedControl
        label={t('web.translate.targetWeight')}
        value={appearance.targetWeight}
        equalWidth
        density="compact"
        options={READING_WEIGHTS.map((targetWeight) => ({
          value: targetWeight,
          label: t(
            targetWeight === 'regular'
              ? 'web.translate.targetWeightRegular'
              : targetWeight === 'medium'
                ? 'web.translate.targetWeightMedium'
                : targetWeight === 'semibold'
                  ? 'web.translate.targetWeightSemibold'
                  : 'web.translate.targetWeightBold',
          ),
        }))}
        onChange={(targetWeight) => onChange({ targetWeight })}
      />
      <SegmentedControl
        label={t('web.translate.align')}
        value={appearance.align}
        equalWidth
        options={READING_ALIGNS.map((align) => ({
          value: align,
          label: t(align === 'start' ? 'web.translate.alignStart' : 'web.translate.alignCenter'),
        }))}
        onChange={(align) => onChange({ align })}
      />
      <SettingsRow icon={Clock} label={t('web.translate.showTime')}>
        <Switch
          aria-label={t('web.translate.showTime')}
          checked={appearance.showTime}
          onCheckedChange={(showTime) => onChange({ showTime })}
        />
      </SettingsRow>

      <Button variant="ghost" className="self-start" onClick={onReset}>
        <RotateCcw aria-hidden />
        {t('web.translate.appearanceReset')}
      </Button>
    </div>
  );
}
