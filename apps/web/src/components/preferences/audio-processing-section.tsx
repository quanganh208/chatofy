'use client';

import { useSyncExternalStore } from 'react';
import type { MicProcessing } from '@chatofy/types';
import { Switch } from '@chatofy/ui/react';
import { SettingsSection, SettingsSectionRow } from '@/components/layout/settings-section';
import type { UseTranslateSettings } from '@/hooks/use-translate-settings';
import { useTranslate } from '@/i18n/provider';

const PROCESSORS = ['echoCancellation', 'noiseSuppression', 'autoGainControl'] as const;

const ALL_SUPPORTED: Record<keyof MicProcessing, boolean> = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

let browserSupport: Record<keyof MicProcessing, boolean> | null = null;

/**
 * What this browser says it can honour. Asked once: the answer cannot change.
 *
 * A browser lists only the constraints it supports, each as `true`, and leaves the
 * rest out rather than reporting `false` — so only `true` counts as supported.
 */
function readBrowserSupport(): Record<keyof MicProcessing, boolean> {
  if (browserSupport) return browserSupport;
  const constraints = navigator.mediaDevices?.getSupportedConstraints?.();
  browserSupport = constraints
    ? {
        echoCancellation: constraints.echoCancellation === true,
        noiseSuppression: constraints.noiseSuppression === true,
        autoGainControl: constraints.autoGainControl === true,
      }
    : ALL_SUPPORTED;
  return browserSupport;
}

const subscribeNever = () => () => {};

/** Test seam: forget the cached answer so a case can stub another browser. */
export function resetBrowserSupportForTests(): void {
  browserSupport = null;
}

type AudioProcessingSectionProps = Pick<UseTranslateSettings, 'settings' | 'ready' | 'set'>;

/**
 * The three processors the browser applies to the microphone, as Saydi offers them.
 *
 * On the page ground, not a card: three unrelated switches are not a thing you work on
 * as a unit, and this screen already spends its two elevated surfaces.
 *
 * A processor the browser says it cannot honour is shown disabled with a note rather
 * than hidden, so the row a reader came looking for is still where they expect it.
 * Assumed supported until the browser answers, because the server render cannot ask.
 */
export function AudioProcessingSection({ settings, ready, set }: AudioProcessingSectionProps) {
  const t = useTranslate();
  const supported = useSyncExternalStore(subscribeNever, readBrowserSupport, () => ALL_SUPPORTED);

  return (
    <SettingsSection title={t('common.audio.title')} note={t('web.preferences.audioHint')}>
      {PROCESSORS.map((key) => {
        // Echo cancellation also says what it costs in a meeting, where the
        // people who hear the echo are the other participants.
        const hint =
          key === 'echoCancellation'
            ? `${t('web.preferences.audio.echoCancellationHint')} ${t('web.preferences.audio.conferenceNote')}`
            : t(`web.preferences.audio.${key}Hint`);
        return (
          <SettingsSectionRow
            key={key}
            label={t(`common.audio.${key}`)}
            note={supported[key] ? hint : `${hint} ${t('web.preferences.audio.unsupported')}`}
          >
            <Switch
              checked={settings.micProcessing[key]}
              disabled={!ready || !supported[key]}
              onCheckedChange={(on) =>
                set({ micProcessing: { ...settings.micProcessing, [key]: on } })
              }
              aria-label={t(`common.audio.${key}`)}
            />
          </SettingsSectionRow>
        );
      })}
      <p className="text-hint text-prose">{t('common.audio.recommendation')}</p>
    </SettingsSection>
  );
}
