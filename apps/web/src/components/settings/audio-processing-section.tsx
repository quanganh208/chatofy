'use client';

import { useSyncExternalStore } from 'react';
import type { MicProcessing } from '@chatofy/types';
import { Switch } from '@chatofy/ui/react';
import { SettingsSection, SettingsSectionRow } from '@/components/settings/settings-section';
import type { UseTranslateSettings } from '@/hooks/use-translate-settings';
import { useTranslate } from '@/i18n/provider';
import type { TranslateSettings } from '@/lib/translate-settings';
import { useSettingSaver } from './use-setting-saver';

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

type AudioProcessingSectionProps = Pick<
  UseTranslateSettings,
  'settings' | 'ready' | 'set' | 'current'
>;

/**
 * The three processors the browser applies to the microphone, as Saydi offers them.
 *
 * The Microphone group of the Translation tab. Each switch confirms itself with a
 * toast that can undo just that switch. Not frozen while a conversation runs: the
 * page reads these at start, so a change applies from the next one, which is what
 * the group's note says.
 *
 * A processor the browser says it cannot honour is shown disabled with a note rather
 * than hidden, so the row a reader came looking for is still where they expect it.
 * Assumed supported until the browser answers, because the server render cannot ask.
 */
export function AudioProcessingSection({
  settings,
  ready,
  set,
  current,
}: AudioProcessingSectionProps) {
  const t = useTranslate();
  const save = useSettingSaver<TranslateSettings>(set, current);
  const supported = useSyncExternalStore(subscribeNever, readBrowserSupport, () => ALL_SUPPORTED);

  return (
    <SettingsSection
      title={t('web.settings.groupMicrophone')}
      note={`${t('web.settings.audioDescription')} ${t('web.preferences.audioHint')}`}
    >
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
                save(
                  key,
                  t(`common.audio.${key}`),
                  { micProcessing: { ...current().micProcessing, [key]: on } },
                  // Only this processor goes back; the other two keep what they are now.
                  (before, now) => ({
                    micProcessing: { ...now.micProcessing, [key]: before.micProcessing[key] },
                  }),
                )
              }
              aria-label={t(`common.audio.${key}`)}
            />
          </SettingsSectionRow>
        );
      })}
      <p className="text-hint text-prose py-3">{t('common.audio.recommendation')}</p>
    </SettingsSection>
  );
}
