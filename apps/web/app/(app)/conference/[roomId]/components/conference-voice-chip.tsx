'use client';

import { Volume2 } from 'lucide-react';
import type { VoiceGender } from '@chatofy/types';
import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SegmentedControl,
} from '@chatofy/ui/react';
import type { UseTranslateSettings } from '@/hooks/use-translate-settings';
import {
  SPEED_PRESETS,
  everyLanguageVoicePatch,
  type LanguageVoiceSetup,
} from '@/lib/translate-settings';
import { LANGUAGE_CODES } from '@chatofy/types';
import { useTranslate } from '@/i18n/provider';

/**
 * The voice other participants hear this speaker's translation in.
 *
 * Meet has nothing like it, so the chip names the voice and the popover says
 * what it is for. It edits the same settings `/translate` uses (the account's
 * preferences): the meeting's speaker leg reads them when it is built, so a speaker
 * sounds the same in both places.
 *
 * One meeting voice, while `/translate` keeps one per language: this chip writes
 * its gender and rate into EVERY language's setup, and names the first one's. A
 * reader who set the languages apart on `/translate` sees them joined again the
 * moment they change something here — which is what one chip for "the voice" says.
 *
 * The settings come from the pre-join stage rather than a hook call of its own:
 * two instances keep two copies, and the stage's save before joining would
 * write its stale copy over a voice changed here.
 */
export function ConferenceVoiceChip({
  voice: { settings, ready, set },
}: {
  voice: Pick<UseTranslateSettings, 'settings' | 'ready' | 'set'>;
}) {
  const t = useTranslate();
  // Defaults on the server render and the hydrating one; a chip shown against
  // them and corrected a frame later reads as the UI changing its mind.
  if (!ready) return null;
  const shown: LanguageVoiceSetup = settings.voiceByLanguage[LANGUAGE_CODES[0]];

  const genderLabel = (gender: VoiceGender) =>
    gender === 'male' ? t('common.conference.voiceMale') : t('common.conference.voiceFemale');

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" data-conference-voice-chip>
          <Volume2 aria-hidden />
          {t('web.conference.translatedVoiceChip', {
            gender: genderLabel(shown.gender),
            speed: String(shown.speed),
          })}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="center" className="flex w-80 flex-col gap-4">
        {/* No heading: the gender control below is labelled with the same words. */}
        <p className="text-hint text-muted-foreground">{t('web.conference.translatedVoiceHint')}</p>
        <SegmentedControl<VoiceGender>
          equalWidth
          label={t('common.conference.translatedVoice')}
          value={shown.gender}
          options={[
            { value: 'female', label: genderLabel('female') },
            { value: 'male', label: genderLabel('male') },
          ]}
          // Clears every per-language voice picked on /translate, so the new
          // gender's default is what plays. Coarser than the /translate panel,
          // which clears only picks of the other gender — that needs the voice
          // catalogs, which this screen does not load.
          onChange={(gender) =>
            set(everyLanguageVoicePatch(settings, { gender, voice: undefined }))
          }
        />
        <SegmentedControl
          label={t('web.translate.speed')}
          density="compact"
          equalWidth
          value={String(shown.speed)}
          options={SPEED_PRESETS.map((preset) => ({
            value: String(preset),
            label: `${preset}×`,
          }))}
          onChange={(value) => set(everyLanguageVoicePatch(settings, { speed: Number(value) }))}
        />
      </PopoverContent>
    </Popover>
  );
}
