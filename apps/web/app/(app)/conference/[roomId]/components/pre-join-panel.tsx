'use client';

import { useEffect, useId, useRef } from 'react';
import { Mic, MicOff, Video, VideoOff } from 'lucide-react';
import type { LanguageCode } from '@chatofy/types';
import { MAX_CONFERENCE_DISPLAY_NAME_CHARS } from '@chatofy/types/events';
import {
  Button,
  Input,
  Label,
  SegmentedControl,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@chatofy/ui/react';
import type { UseTranslateSettings } from '@/hooks/use-translate-settings';
import { useTranslate } from '@/i18n/provider';
import { languageNamer } from '@/i18n/language-pair-labels';
import type { PreJoinMedia } from '../hooks/use-pre-join-media';
import { ConferenceVoiceChip } from './conference-voice-chip';
import { MicLevelMeter } from './mic-level-meter';
import { DAWN_GRADIENT } from '../../components/dawn-glow';
import { initials } from '../utils/initials';

/** Radix reserves "" for a Select holding nothing, so the default needs a value of its own. */
const SYSTEM_DEFAULT = 'default';

/** A label on the left, its control filling the rest — one settings row. */
const ROW = 'grid grid-cols-[9rem_minmax(0,1fr)] items-center gap-3';

interface PreJoinPanelProps {
  media: PreJoinMedia;
  name: string;
  onNameChange: (name: string) => void;
  language: LanguageCode;
  onLanguageChange: (language: LanguageCode) => void;
  onJoin: () => void;
  joining: boolean;
  /** The translated-voice settings, owned by the stage. */
  voice: UseTranslateSettings;
}

/**
 * The green room: see yourself, hear yourself, say who you are, then join.
 *
 * Two columns from `lg`: the preview is media — rounded, nothing around it — and
 * the settings sit on the page ground as rows divided by hairlines, ending in
 * Join now. One column below `lg`, preview first.
 *
 * Design budget: "Join now" is the one accent-filled control. The toggles are
 * outline, the pickers are fields, the voice chip is outline. No elevated surface:
 * no card around the preview or the settings.
 */
export function PreJoinPanel({
  media,
  name,
  onNameChange,
  language,
  onLanguageChange,
  onJoin,
  joining,
  voice,
}: PreJoinPanelProps) {
  const t = useTranslate();
  const nameLanguage = languageNamer(t);
  const micLabelId = useId();
  const camLabelId = useId();
  const voiceLabelId = useId();
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = media.stream;
  }, [media.stream]);

  const showVideo = media.camOn && Boolean(media.stream?.getVideoTracks().length);

  return (
    // The room is a flush route — a fixed-height frame that never scrolls — so
    // this screen scrolls itself, and `m-auto` centres it on both axes while it
    // fits and lets it scroll from the top when it does not.
    <div className="flex min-h-0 flex-1 overflow-y-auto">
      <div className="m-auto grid w-full max-w-6xl items-center gap-6 px-6 py-4 lg:gap-10 lg:py-10 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-3">
          <div className="bg-muted relative aspect-video w-full overflow-hidden rounded-2xl">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={showVideo ? 'h-full w-full -scale-x-100 object-cover' : 'hidden'}
            />
            {showVideo && name.trim() && (
              <p className="text-body absolute left-4 top-3 font-medium text-white drop-shadow">
                {name.trim()}
              </p>
            )}
            {!showVideo && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 pb-10">
                {name.trim() && (
                  // A dawn ring around a neutral disc: the initials sit on the
                  // card colour, never on the dawn itself.
                  <div
                    aria-hidden
                    className="rounded-full p-1"
                    style={{ backgroundImage: DAWN_GRADIENT }}
                  >
                    <div className="bg-card text-title flex size-24 items-center justify-center rounded-full font-semibold">
                      {initials(name)}
                    </div>
                  </div>
                )}
                <p className="text-body text-muted-foreground">
                  {t('web.conference.noCameraPreview')}
                </p>
              </div>
            )}
            <div className="absolute inset-x-0 bottom-4 flex justify-center gap-4">
              <Button
                type="button"
                // Off is a state worth seeing at a glance: the live fill, as on
                // Stop. It is not the accent, so the budget is untouched.
                variant={media.micOn ? 'outline' : 'destructive'}
                size="icon"
                className="size-12 rounded-full [&_svg]:size-5"
                aria-pressed={!media.micOn}
                aria-label={
                  media.micOn ? t('common.conference.muteMic') : t('common.conference.unmuteMic')
                }
                onClick={() => media.setMicOn(!media.micOn)}
              >
                {media.micOn ? <Mic aria-hidden /> : <MicOff aria-hidden />}
              </Button>
              <Button
                type="button"
                variant={media.camOn ? 'outline' : 'destructive'}
                size="icon"
                className="size-12 rounded-full [&_svg]:size-5"
                aria-pressed={!media.camOn}
                aria-label={
                  media.camOn
                    ? t('common.conference.disableCamera')
                    : t('common.conference.enableCamera')
                }
                onClick={() => media.setCamOn(!media.camOn)}
              >
                {media.camOn ? <Video aria-hidden /> : <VideoOff aria-hidden />}
              </Button>
            </div>
          </div>

          <MicLevelMeter level={media.level} label={t('web.conference.micLevel')} />
        </div>

        {/* Not a <form>: the voice chip and the segmented controls are buttons, and
          any of them without an explicit type would submit it. */}
        <div className="flex w-full flex-col gap-4" data-pre-join-settings>
          <h2 className="text-heading font-display">{t('web.conference.readyToJoin')}</h2>

          <div className="border-hairline divide-hairline flex flex-col divide-y border-y">
            <div className="flex flex-col gap-2 py-3">
              <Label htmlFor="conf-name">{t('common.conference.yourName')}</Label>
              <Input
                id="conf-name"
                value={name}
                onChange={(e) => onNameChange(e.target.value)}
                placeholder={t('common.conference.yourNamePlaceholder')}
                autoComplete="name"
                maxLength={MAX_CONFERENCE_DISPLAY_NAME_CHARS}
              />
            </div>

            <div className="py-3">
              <SegmentedControl<LanguageCode>
                equalWidth
                label={t('common.conference.sourceLanguage')}
                value={language}
                onChange={onLanguageChange}
                options={[
                  { value: 'vi', label: nameLanguage('vi') },
                  { value: 'en', label: nameLanguage('en') },
                  { value: 'zh', label: nameLanguage('zh') },
                ]}
              />
            </div>

            <div className="flex flex-col gap-1.5 py-3">
              <div className={ROW}>
                <Label id={micLabelId}>{t('web.conference.microphone')}</Label>
                <Select
                  value={media.micId ?? SYSTEM_DEFAULT}
                  onValueChange={(id) => media.setMicId(id === SYSTEM_DEFAULT ? undefined : id)}
                >
                  <SelectTrigger aria-labelledby={micLabelId} className="w-full min-w-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SYSTEM_DEFAULT}>
                      {t('web.conference.defaultDevice')}
                    </SelectItem>
                    {media.mics
                      .filter((device) => device.deviceId && device.deviceId !== SYSTEM_DEFAULT)
                      .map((device, index) => (
                        <SelectItem key={device.deviceId} value={device.deviceId}>
                          {device.label || `${t('web.conference.microphone')} ${index + 1}`}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              {/* Said here, before joining, because it is the other people who pay
                  for it: with echo cancellation off they hear their own voice back. */}
              {voice.ready && !voice.settings.micProcessing.echoCancellation ? (
                <p className="text-muted-foreground text-hint">
                  {t('web.preferences.audio.conferenceNote')}
                </p>
              ) : null}
            </div>

            <div className={`${ROW} py-3`}>
              <Label id={camLabelId}>{t('web.conference.camera')}</Label>
              <Select
                value={media.camId ?? SYSTEM_DEFAULT}
                onValueChange={(id) => media.setCamId(id === SYSTEM_DEFAULT ? undefined : id)}
              >
                <SelectTrigger aria-labelledby={camLabelId} className="w-full min-w-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SYSTEM_DEFAULT}>
                    {t('web.conference.defaultDevice')}
                  </SelectItem>
                  {media.cams
                    .filter((device) => device.deviceId && device.deviceId !== SYSTEM_DEFAULT)
                    .map((device, index) => (
                      <SelectItem key={device.deviceId} value={device.deviceId}>
                        {device.label || `${t('web.conference.camera')} ${index + 1}`}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            {/* The chip renders nothing until settings load, so the row waits with it
                rather than drawing a label beside an empty cell. */}
            {voice.ready ? (
              <div className={`${ROW} py-3`} role="group" aria-labelledby={voiceLabelId}>
                <span id={voiceLabelId} className="text-body leading-none font-medium">
                  {t('common.conference.translatedVoice')}
                </span>
                <div className="flex min-w-0 justify-end">
                  <ConferenceVoiceChip voice={voice} />
                </div>
              </div>
            ) : null}
          </div>

          <Button size="lg" className="w-full" disabled={!name.trim() || joining} onClick={onJoin}>
            {joining ? t('common.conference.connecting') : t('web.conference.joinNow')}
          </Button>
        </div>
      </div>
    </div>
  );
}
